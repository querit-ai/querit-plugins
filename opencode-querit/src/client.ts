/**
 * Credential-safe client for the public Querit API
 * (`POST https://api.querit.ai/v1/search` and `/v1/contents`).
 * Structure follows the client shipped by pi-querit / dsh-querit (MIT):
 * response-size limits, deduplication, URL normalization, and API-key
 * redaction from every error surface.
 * @module opencode-querit/client
 */
import { sanitizeUntrustedText } from "./sanitize.js";

export const QUERIT_API_BASE_URL = "https://api.querit.ai";
export const DEFAULT_REQUEST_TIMEOUT_MS = 70_000;

const SEARCH_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const CONTENTS_RESPONSE_MAX_BYTES = 10 * 1024 * 1024;
const ERROR_RESPONSE_MAX_BYTES = 8 * 1024;

export interface QueritSearchRequest {
  query: string;
  count: number;
  chunksPerDoc?: number;
  needContent?: boolean;
  filters?: {
    sites?: { include?: string[]; exclude?: string[] };
    timeRange?: { date: string };
    geo?: { countries: { include: string[] } };
    languages?: { include: string[] };
  };
}

export interface QueritContentsRequest {
  urls: string[];
  format: "text" | "markdown" | "html";
  crawlTimeout: number;
  extrasMeta: boolean;
}

export interface QueritSearchResult {
  title: string;
  url: string;
  snippet: string;
  pageAge?: string;
  siteName?: string;
  siteIcon?: string;
  sentences: string[];
}

export interface QueritSearchResponse {
  searchId?: string;
  took?: string;
  query: string;
  results: QueritSearchResult[];
}

export interface QueritContentMetadata {
  title?: string;
  url?: string;
  publishTime?: string;
  siteName?: string;
  siteIcon?: string;
}

export interface QueritContentResult {
  id?: string;
  url: string;
  content: string;
  metadata?: QueritContentMetadata;
}

export interface QueritContentStatus {
  id?: string;
  status?: string;
}

export interface QueritContentsResponse {
  searchId?: string;
  results: QueritContentResult[];
  statuses: QueritContentStatus[];
  searchTime?: number;
}

export interface QueritClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

interface ParsedResponse {
  body: Record<string, unknown>;
  searchId?: string;
}

export class QueritApiError extends Error {
  readonly status?: number;
  readonly searchId?: string;

  constructor(message: string, options: { status?: number; searchId?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "QueritApiError";
    this.status = options.status;
    this.searchId = options.searchId;
  }
}

export class QueritClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: QueritClientOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) {
      throw new QueritApiError("A Querit API key is required.");
    }

    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = (options.baseUrl ?? QUERIT_API_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async search(request: QueritSearchRequest, signal?: AbortSignal): Promise<QueritSearchResponse> {
    const response = await this.postJson("/v1/search", request, SEARCH_RESPONSE_MAX_BYTES, signal);
    return normalizeSearchResponse(response.body, response.searchId, request.query);
  }

  async contents(request: QueritContentsRequest, signal?: AbortSignal): Promise<QueritContentsResponse> {
    const response = await this.postJson("/v1/contents", request, CONTENTS_RESPONSE_MAX_BYTES, signal);
    return normalizeContentsResponse(response.body, response.searchId);
  }

  private async postJson(
    path: string,
    requestBody: QueritSearchRequest | QueritContentsRequest,
    responseLimit: number,
    callerSignal?: AbortSignal,
  ): Promise<ParsedResponse> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (error) {
      if (callerSignal?.aborted) {
        throw new QueritApiError("Querit request was cancelled.", { cause: error });
      }
      if (timeoutSignal.aborted) {
        throw new QueritApiError(`Querit request timed out after ${this.timeoutMs} ms.`, { cause: error });
      }
      throw new QueritApiError(`Querit request failed: ${errorMessage(error)}`, { cause: error });
    }

    const bodyLimit = response.ok ? responseLimit : ERROR_RESPONSE_MAX_BYTES;
    let text: string;
    try {
      text = await readResponseText(response, bodyLimit);
    } catch (error) {
      if (callerSignal?.aborted) {
        throw new QueritApiError("Querit request was cancelled.", { status: response.status, cause: error });
      }
      if (timeoutSignal.aborted) {
        throw new QueritApiError(`Querit request timed out after ${this.timeoutMs} ms.`, {
          status: response.status,
          cause: error,
        });
      }
      throw new QueritApiError(`Could not read the Querit response: ${errorMessage(error)}`, {
        status: response.status,
        cause: error,
      });
    }

    const searchId = extractSearchId(text);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      const excerpt = redactSecret(text.slice(0, 500), this.apiKey);
      if (!response.ok) {
        throw new QueritApiError(
          `Querit API request failed with HTTP ${response.status}${excerpt ? `: ${excerpt}` : "."}`,
          { status: response.status, searchId, cause: error },
        );
      }
      throw new QueritApiError(
        `Querit returned invalid JSON${excerpt ? `: ${excerpt}` : "."}`,
        { status: response.status, searchId, cause: error },
      );
    }

    if (!isRecord(payload)) {
      throw new QueritApiError("Querit returned an invalid response object.", {
        status: response.status,
        searchId,
      });
    }

    const apiErrorCode = optionalString(payload.error_code);
    const apiErrorMessage = optionalString(payload.error_msg);
    const numericErrorCode = apiErrorCode === undefined ? undefined : Number(apiErrorCode);
    if (!response.ok || (Number.isFinite(numericErrorCode) && numericErrorCode !== 200)) {
      const message = redactSecret(
        apiErrorMessage ?? `Querit API request failed with HTTP ${response.status}.`,
        this.apiKey,
      );
      throw new QueritApiError(message, { status: response.status, searchId });
    }

    return { body: payload, searchId };
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

  if (!response.body) {
    return "";
  }

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
  searchId: string | undefined,
  requestedQuery: string,
): QueritSearchResponse {
  const resultsContainer = payload.results;
  if (!isRecord(resultsContainer) || !Array.isArray(resultsContainer.result)) {
    throw new QueritApiError("Querit search response is missing results.result.", { searchId });
  }

  const deduplicated = new Map<string, QueritSearchResult>();
  for (const rawItem of resultsContainer.result) {
    if (!isRecord(rawItem)) continue;
    const url = normalizeHttpUrl(rawItem.url);
    if (!url || deduplicated.has(url)) continue;

    deduplicated.set(url, {
      title: optionalString(rawItem.title) ?? url,
      url,
      snippet: optionalString(rawItem.snippet) ?? "",
      pageAge: optionalString(rawItem.page_age),
      siteName: optionalString(rawItem.site_name),
      siteIcon: optionalString(rawItem.site_icon),
      sentences: Array.isArray(rawItem.sentence)
        ? rawItem.sentence.filter((value): value is string => typeof value === "string")
        : [],
    });
  }

  const queryContext = isRecord(payload.query_context) ? payload.query_context : undefined;
  return {
    searchId,
    took: optionalString(payload.took),
    query: queryContext ? optionalString(queryContext.query) ?? requestedQuery : requestedQuery,
    results: [...deduplicated.values()],
  };
}

function normalizeContentsResponse(
  payload: Record<string, unknown>,
  searchId: string | undefined,
): QueritContentsResponse {
  if (!Array.isArray(payload.results) || !Array.isArray(payload.statuses)) {
    throw new QueritApiError("Querit contents response is missing results or statuses.", { searchId });
  }

  const deduplicated = new Map<string, QueritContentResult>();
  for (const rawResult of payload.results) {
    if (!isRecord(rawResult)) continue;
    const url = normalizeHttpUrl(rawResult.url);
    if (!url || deduplicated.has(url)) continue;

    const rawMetadata = isRecord(rawResult.extrasMeta) ? rawResult.extrasMeta : undefined;
    const metadata = rawMetadata
      ? {
          title: optionalString(rawMetadata.title),
          url: normalizeHttpUrl(rawMetadata.url),
          publishTime: optionalString(rawMetadata.publishTime),
          siteName: optionalString(rawMetadata.siteName),
          siteIcon: normalizeHttpUrl(rawMetadata.siteIcon),
        }
      : undefined;

    deduplicated.set(url, {
      id: optionalString(rawResult.id),
      url,
      content: optionalString(rawResult.content) ?? "",
      metadata,
    });
  }

  const statuses = payload.statuses
    .filter(isRecord)
    .map((status) => ({
      id: optionalString(status.id),
      status: optionalString(status.status),
    }));

  return {
    searchId,
    results: [...deduplicated.values()],
    statuses,
    searchTime: optionalNumber(payload.searchTime),
  };
}

function extractSearchId(text: string): string | undefined {
  const match = /"search_id"\s*:\s*(?:"([^"]+)"|(-?\d+))/.exec(text);
  const value = match?.[1] ?? match?.[2];
  return value && /^-?\d+$/.test(value) ? value : undefined;
}

function normalizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function redactSecret(text: string, secret: string): string {
  const redacted = secret ? text.split(secret).join("[REDACTED]") : text;
  return sanitizeUntrustedText(redacted);
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return sanitizeUntrustedText(error instanceof Error ? error.message : String(error));
}
