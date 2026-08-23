import { IntegrationError } from "./errors.js";
import { redactSecrets, safeErrorMessage } from "./security.js";
import type { SearchAdapter, SearchCandidate, SearchResponse } from "./types.js";

const DEFAULT_BASE_URL = "https://api.querit.ai";
const DEFAULT_RESULT_COUNT = 5;
const DEFAULT_TIMEOUT_MS = 70_000;
const ERROR_RESPONSE_MAX_BYTES = 8 * 1_024;
const SEARCH_RESPONSE_MAX_BYTES = 2 * 1_024 * 1_024;

export interface QueritSearchAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  count?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class QueritApiError extends IntegrationError {
  readonly searchId: string | undefined;
  readonly status: number | undefined;

  constructor(
    message: string,
    options: { cause?: unknown; searchId?: string; status?: number } = {},
  ) {
    super("QUERIT_API_ERROR", message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "QueritApiError";
    this.searchId = options.searchId;
    this.status = options.status;
  }
}

export class QueritSearchAdapter implements SearchAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly count: number;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: QueritSearchAdapterOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new IntegrationError("INVALID_CONFIGURATION", "QUERIT_API_KEY is required.");

    const count = options.count ?? DEFAULT_RESULT_COUNT;
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new IntegrationError("INVALID_CONFIGURATION", "Querit result count must be between 1 and 20.");
    }

    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.count = count;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async search(query: string): Promise<SearchResponse> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/search`, {
        body: JSON.stringify({
          query,
          count: this.count,
          chunksPerDoc: 1,
          needContent: true,
        }),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: timeoutSignal,
      });
    } catch (error) {
      if (timeoutSignal.aborted) {
        throw new QueritApiError(`Querit search timed out after ${this.timeoutMs} ms.`, { cause: error });
      }
      throw new QueritApiError(`Querit search request failed: ${safeErrorMessage(error, [this.apiKey])}`, {
        cause: error,
      });
    }

    const maxBytes = response.ok ? SEARCH_RESPONSE_MAX_BYTES : ERROR_RESPONSE_MAX_BYTES;
    let text: string;
    try {
      text = await readResponseText(response, maxBytes);
    } catch (error) {
      throw new QueritApiError(`Could not read the Querit response: ${safeErrorMessage(error, [this.apiKey])}`, {
        cause: error,
        status: response.status,
      });
    }

    const searchId = extractSearchId(text);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      const excerpt = redactSecrets(text.slice(0, 500), [this.apiKey]);
      const detail = excerpt ? `: ${excerpt}` : ".";
      throw new QueritApiError(
        response.ok
          ? `Querit returned invalid JSON${detail}`
          : `Querit API request failed with HTTP ${response.status}${detail}`,
        {
          cause: error,
          ...(searchId === undefined ? {} : { searchId }),
          status: response.status,
        },
      );
    }

    if (!isRecord(payload)) {
      throw new QueritApiError("Querit returned an invalid response object.", {
        ...(searchId === undefined ? {} : { searchId }),
        status: response.status,
      });
    }

    const errorCode = optionalString(payload.error_code);
    const numericErrorCode = errorCode === undefined ? undefined : Number(errorCode);
    if (!response.ok || (Number.isFinite(numericErrorCode) && numericErrorCode !== 200)) {
      const message = redactSecrets(
        optionalString(payload.error_msg) ?? `Querit API request failed with HTTP ${response.status}.`,
        [this.apiKey],
      );
      throw new QueritApiError(message, {
        ...(searchId === undefined ? {} : { searchId }),
        status: response.status,
      });
    }

    return normalizeSearchResponse(payload, query, searchId);
  }
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`response exceeds the ${maxBytes}-byte limit`);
    }
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("response size limit exceeded");
        throw new Error(`response exceeds the ${maxBytes}-byte limit`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

function normalizeSearchResponse(
  payload: Record<string, unknown>,
  requestedQuery: string,
  searchId: string | undefined,
): SearchResponse {
  const container = payload.results;
  if (!isRecord(container) || !Array.isArray(container.result)) {
    throw new QueritApiError("Querit search response is missing results.result.", {
      ...(searchId === undefined ? {} : { searchId }),
    });
  }

  const results: SearchCandidate[] = [];
  for (const item of container.result) {
    if (!isRecord(item) || typeof item.url !== "string") continue;

    const siteName = optionalString(item.site_name);
    const publishedAt = optionalString(item.page_age);
    results.push({
      title: optionalString(item.title) ?? item.url,
      url: item.url,
      snippet: optionalString(item.snippet) ?? "",
      passages: Array.isArray(item.sentence)
        ? item.sentence.filter((value): value is string => typeof value === "string")
        : [],
      ...(siteName === undefined ? {} : { siteName }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    });
  }

  const queryContext = isRecord(payload.query_context) ? payload.query_context : undefined;
  const normalizedQuery = queryContext ? optionalString(queryContext.query) ?? requestedQuery : requestedQuery;
  return {
    query: normalizedQuery,
    results,
    ...(searchId === undefined ? {} : { searchId }),
  };
}

function extractSearchId(text: string): string | undefined {
  const match = /"search_id"\s*:\s*(?:"([^"]+)"|(-?\d+))/.exec(text);
  return match?.[1] ?? match?.[2];
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
