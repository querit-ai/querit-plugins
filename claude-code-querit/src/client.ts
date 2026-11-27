import { redactSecrets, safeErrorMessage } from "./sanitize.js";

export const QUERIT_API_BASE_URL = "https://api.querit.ai";
export const DEFAULT_REQUEST_TIMEOUT_MS = 70_000;
/** Largest `count` the search API accepts. */
export const QUERIT_COUNT_LIMIT = 100;
/** Inclusive bounds of `highlights.maxCharacters`. */
export const QUERIT_HIGHLIGHT_MIN_CHARACTERS = 100;
export const QUERIT_HIGHLIGHT_MAX_CHARACTERS = 8_000;
/** Largest `contentMaxChars` the search and contents APIs accept. */
export const QUERIT_CONTENT_MAX_CHARS_LIMIT = 1_000_000;
/** The values `filters.vertical`, `rank.preference`, and the contents `format` accept. */
export const VERTICAL_VALUES = ["code", "finance"] as const;
export const RANK_VALUES = ["relevance", "freshness"] as const;
export const CONTENT_FORMAT_VALUES = ["text", "markdown", "html"] as const;

const SEARCH_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const CONTENTS_RESPONSE_MAX_BYTES = 10 * 1024 * 1024;
const ERROR_RESPONSE_MAX_BYTES = 8 * 1024;
/** Querit documents these as the only statuses worth retrying; never 400, 401, 403, or 404. */
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const DEFAULT_RETRY: QueritRetryOptions = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5_000 };

export type QueritVertical = (typeof VERTICAL_VALUES)[number];
export type QueritRankPreference = (typeof RANK_VALUES)[number];

/** Query-focused fragments of body text, for search results and fetched pages alike. */
export interface QueritHighlights {
  query?: string | undefined;
  maxCharacters?: number | undefined;
}

export interface QueritSearchRequest {
  query: string;
  /** Omit to let Querit apply its server default. */
  count?: number | undefined;
  /** Deprecated by Querit in favor of `highlights`. Send only when a user explicitly configured it. */
  chunksPerDoc?: number | undefined;
  highlights?: boolean | QueritHighlights | undefined;
  needContent?: boolean | undefined;
  /** Body-text limit per result; only meaningful together with `needContent: true`. */
  contentMaxChars?: number | undefined;
  /** Enterprise only; ignored by Querit on other plans. */
  needMarkdown?: boolean | undefined;
  /** Returns 400 when combined with `filters.vertical: "code"`. */
  rank?: { preference: QueritRankPreference } | undefined;
  filters?: {
    sites?: { include?: string[] | undefined; exclude?: string[] | undefined } | undefined;
    timeRange?: { date: string } | undefined;
    geo?: { countries: { include: string[] } } | undefined;
    languages?: { include: string[] } | undefined;
    /** Omit for universal search; a mismatched vertical loses results. */
    vertical?: QueritVertical | undefined;
  } | undefined;
}

export interface QueritContentsRequest {
  urls: string[];
  format: (typeof CONTENT_FORMAT_VALUES)[number];
  crawlTimeout: number;
  extrasMeta: boolean;
  /** Content limit per URL. Omit for the full available content. */
  contentMaxChars?: number | undefined;
  highlights?: QueritHighlights | undefined;
}

interface QueritCost {
  /** Querit always reports "USD". */
  currency: string;
  /** Charge in dollars with up to six decimal places; 0 is a reported zero charge. */
  total: number;
}

export interface QueritSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** A plaintext time in UTC+0, not ISO-8601. */
  pageAge?: string | undefined;
  siteName?: string | undefined;
  siteIcon?: string | undefined;
  /** Body text, present only when `needContent: true` was requested and is available. */
  sentences: string[];
  /** Query-focused fragments, present only when `highlights` was requested and is available. */
  highlights: string[];
  /** Markdown versions. Omitted unless `needMarkdown: true` was requested on an Enterprise plan. */
  snippetMarkdown?: string[] | undefined;
  contentMarkdown?: string | undefined;
}

export interface QueritSearchResponse {
  searchId?: string | undefined;
  took?: string | undefined;
  /** Absent means unavailable, never "free". */
  cost?: QueritCost | undefined;
  query: string;
  results: QueritSearchResult[];
}

interface QueritContentMetadata {
  title?: string | undefined;
  url?: string | undefined;
  publishTime?: string | undefined;
  siteName?: string | undefined;
  siteIcon?: string | undefined;
}

interface QueritContentResult {
  id?: string | undefined;
  url: string;
  content: string;
  /** Query-focused fragments, present only when `highlights` was requested and is available. */
  highlights: string[];
  metadata?: QueritContentMetadata | undefined;
}

interface QueritContentStatus {
  id?: string | undefined;
  status?: string | undefined;
}

export interface QueritContentsResponse {
  searchId?: string | undefined;
  results: QueritContentResult[];
  statuses: QueritContentStatus[];
  searchTime?: number | undefined;
  /** Absent means unavailable, never "free". */
  cost?: QueritCost | undefined;
}

export interface QueritRetryOptions {
  /** Retries after the first attempt. `0` disables retries. */
  maxRetries: number;
  baseDelayMs: number;
  /**
   * Ceiling for backoff waits and for an honored `Retry-After`. A `Retry-After` that
   * exceeds it is not waited out: the tool call fails instead of blocking the agent.
   */
  maxDelayMs: number;
}

export interface QueritClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch | undefined;
  baseUrl?: string | undefined;
  /** Deadline for the whole operation, retries and backoff waits included. */
  timeoutMs?: number | undefined;
  retry?: Partial<QueritRetryOptions> | undefined;
}

interface ParsedResponse {
  body: Record<string, unknown>;
  searchId?: string | undefined;
}

/** The signals one operation runs under. */
interface Operation {
  /** What the request and the backoff waits listen to: the caller's signal and the deadline together. */
  signal: AbortSignal;
  callerSignal: AbortSignal | undefined;
  deadline: AbortSignal;
}

interface QueritApiErrorOptions {
  status?: number | undefined;
  searchId?: string | undefined;
  retryAfterMs?: number | undefined;
  attempts?: number | undefined;
  cause?: unknown;
}

export class QueritApiError extends Error {
  readonly status: number | undefined;
  readonly searchId: string | undefined;
  /** Wait the server asked for through `Retry-After`, when it sent one. */
  readonly retryAfterMs: number | undefined;
  /** Requests sent before giving up, including the first. */
  readonly attempts: number;

  constructor(message: string, options: QueritApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "QueritApiError";
    this.status = options.status;
    this.searchId = options.searchId;
    this.retryAfterMs = options.retryAfterMs;
    this.attempts = options.attempts ?? 1;
  }
}

export class QueritClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retry: QueritRetryOptions;

  constructor(options: QueritClientOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new QueritApiError("A Querit API key is required.");

    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? QUERIT_API_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000) {
      throw new QueritApiError("Querit request timeout must be an integer of at least 1000 ms.");
    }
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    if (!Object.values(this.retry).every((value) => Number.isInteger(value) && value >= 0)) {
      throw new QueritApiError("Querit retry options must be integers of at least 0.");
    }
  }

  async search(request: QueritSearchRequest, signal?: AbortSignal): Promise<QueritSearchResponse> {
    const response = await this.postJson("/v1/search", request, SEARCH_RESPONSE_MAX_BYTES, signal);
    return normalizeSearchResponse(response.body, response.searchId, request.query);
  }

  async contents(request: QueritContentsRequest, signal?: AbortSignal): Promise<QueritContentsResponse> {
    const response = await this.postJson("/v1/contents", request, CONTENTS_RESPONSE_MAX_BYTES, signal);
    return normalizeContentsResponse(response.body, response.searchId);
  }

  /**
   * Posts the request, retrying the statuses Querit calls transient with bounded
   * exponential backoff. One deadline covers every attempt and wait.
   */
  private async postJson(
    path: string,
    requestBody: QueritSearchRequest | QueritContentsRequest,
    responseLimit: number,
    callerSignal?: AbortSignal,
  ): Promise<ParsedResponse> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const operation: Operation = {
      deadline,
      callerSignal,
      signal: callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline,
    };

    for (let retries = 0; ; retries++) {
      let failure: QueritApiError;
      try {
        return await this.attempt(path, requestBody, responseLimit, operation);
      } catch (error) {
        failure = error instanceof QueritApiError
          ? error
          : new QueritApiError(this.safeMessage(error), { cause: this.safeCause(error) });
      }

      // A cancellation or timeout carries no HTTP status, and any other status is outside the
      // documented set: neither is a transient server state.
      if (!RETRYABLE_STATUSES.has(failure.status ?? 0) || retries >= this.retry.maxRetries) {
        throw finalFailure(failure, retries + 1);
      }

      const waitMs = retryDelayMs(failure.retryAfterMs, retries, this.retry);
      if (waitMs === undefined) {
        // Honor an over-long Retry-After by not retrying sooner.
        throw finalFailure(new QueritApiError(
          `${failure.message} Querit asked to retry after ${Math.ceil((failure.retryAfterMs ?? 0) / 1_000)}s, `
          + `longer than the ${this.retry.maxDelayMs} ms this client waits; not retried.`,
          { status: failure.status, searchId: failure.searchId, retryAfterMs: failure.retryAfterMs, cause: failure },
        ), retries + 1);
      }

      try {
        await sleep(waitMs, operation.signal);
      } catch (cancelled) {
        throw this.interrupted(cancelled, operation, this.safeMessage(cancelled));
      }
    }
  }

  private async attempt(
    path: string,
    requestBody: QueritSearchRequest | QueritContentsRequest,
    responseLimit: number,
    operation: Operation,
  ): Promise<ParsedResponse> {
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
        signal: operation.signal,
      });
    } catch (error) {
      throw this.interrupted(error, operation, `Querit request failed: ${this.safeMessage(error)}`);
    }

    const bodyLimit = response.ok ? responseLimit : ERROR_RESPONSE_MAX_BYTES;
    let text: string;
    try {
      text = await readResponseText(response, bodyLimit);
    } catch (error) {
      throw this.interrupted(
        error,
        operation,
        `Could not read the Querit response: ${this.safeMessage(error)}`,
        response.status,
      );
    }

    const searchId = extractSearchId(text);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      const excerpt = redactSecrets(text.slice(0, 500), [this.apiKey]);
      if (!response.ok) {
        throw this.apiError(
          `Querit API request failed with HTTP ${response.status}${excerpt ? `: ${excerpt}` : "."}`,
          response,
          response.status,
          searchId,
        );
      }
      throw new QueritApiError(`Querit returned invalid JSON${excerpt ? `: ${excerpt}` : "."}`, {
        status: response.status,
        searchId,
      });
    }

    if (!isRecord(payload)) {
      throw new QueritApiError("Querit returned an invalid response object.", { status: response.status, searchId });
    }

    const apiErrorCode = optionalString(payload.error_code);
    const apiErrorMessage = optionalString(payload.error_msg);
    const numericErrorCode = apiErrorCode === undefined ? undefined : Number(apiErrorCode);
    // Querit asks clients to check error_code even on an HTTP 200.
    if (!response.ok || (Number.isFinite(numericErrorCode) && numericErrorCode !== 200)) {
      // error_code is the request's own verdict; the HTTP status stands in when the body has none.
      const status = response.ok ? (numericErrorCode ?? response.status) : response.status;
      throw this.apiError(
        redactSecrets(apiErrorMessage ?? `Querit API request failed with HTTP ${response.status}.`, [this.apiKey]),
        response,
        status,
        searchId,
      );
    }

    return { body: payload, searchId };
  }

  /**
   * Marks an API failure with its status and Retry-After so postJson can decide whether
   * to retry. search_id stays on the error; postJson puts it in the final message.
   */
  private apiError(message: string, response: Response, status: number, searchId: string | undefined): QueritApiError {
    return new QueritApiError(message, {
      status,
      searchId,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    });
  }

  /**
   * Says when the caller cancelled or the deadline passed — neither is a transient server
   * state, so neither is retried — and otherwise reports `failure`. `status` is the HTTP
   * status, when a response had already arrived.
   */
  private interrupted(error: unknown, operation: Operation, failure: string, status?: number): QueritApiError {
    if (operation.callerSignal?.aborted) {
      return new QueritApiError("Querit request was cancelled.", { status, cause: this.safeCause(error) });
    }
    if (operation.deadline.aborted) {
      return new QueritApiError(`Querit request timed out after ${this.timeoutMs} ms.`, {
        status,
        cause: this.safeCause(error),
      });
    }
    return new QueritApiError(failure, { status, cause: this.safeCause(error) });
  }

  private safeMessage(error: unknown): string {
    return safeErrorMessage(error, [this.apiKey]);
  }

  private safeCause(error: unknown): Error {
    return new Error(this.safeMessage(error));
  }
}

/**
 * Renders the failure a caller sees: the attempt count when the first one was retried, and
 * the request's search_id at the very end, because support needs it to trace the request.
 */
function finalFailure(failure: QueritApiError, attempts: number): QueritApiError {
  const message = attempts > 1
    ? `Querit request failed after ${attempts} attempts: ${failure.message}`
    : failure.message;
  return new QueritApiError(withSearchId(message, failure.searchId), {
    status: failure.status,
    searchId: failure.searchId,
    retryAfterMs: failure.retryAfterMs,
    attempts,
    cause: failure,
  });
}

/** Ends a message with search_id. extractSearchId admits digits only, so it is safe to embed. */
function withSearchId(message: string, searchId: string | undefined): string {
  return searchId ? `${message} [search_id: ${searchId}]` : message;
}

function retryDelayMs(retryAfterMs: number | undefined, attempt: number, retry: QueritRetryOptions): number | undefined {
  if (retryAfterMs !== undefined) {
    return retryAfterMs <= retry.maxDelayMs ? retryAfterMs : undefined;
  }
  // Equal jitter: half the ceiling plus a random half, so waits back off without clustering.
  const ceiling = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

/** Parses `Retry-After` in both forms the HTTP spec allows: delay-seconds or an HTTP-date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    return Math.max(0, Math.ceil(Number(trimmed) * 1_000));
  }
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - now);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
        await reader.cancel("response size limit exceeded").catch(() => undefined);
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
    throw new QueritApiError(withSearchId("Querit search response is missing results.result.", searchId), { searchId });
  }

  const deduplicated = new Map<string, QueritSearchResult>();
  for (const rawItem of resultsContainer.result) {
    if (!isRecord(rawItem)) continue;
    const url = normalizeHttpUrl(rawItem.url);
    // Every result field is optional; a result without a usable URL cannot be cited.
    if (!url || deduplicated.has(url)) continue;

    deduplicated.set(url, {
      title: optionalString(rawItem.title) ?? url,
      url,
      snippet: optionalString(rawItem.snippet) ?? "",
      pageAge: optionalString(rawItem.page_age),
      siteName: optionalString(rawItem.site_name),
      siteIcon: normalizeHttpUrl(rawItem.site_icon),
      sentences: stringList(rawItem.sentence),
      highlights: stringList(rawItem.highlights),
      snippetMarkdown: optionalStringList(rawItem.snippet_markdown),
      contentMarkdown: optionalString(rawItem.content_markdown),
    });
  }

  const queryContext = isRecord(payload.query_context) ? payload.query_context : undefined;
  return {
    searchId,
    took: optionalString(payload.took),
    cost: normalizeCost(payload.cost),
    query: queryContext ? optionalString(queryContext.query) ?? requestedQuery : requestedQuery,
    results: [...deduplicated.values()],
  };
}

function normalizeContentsResponse(
  payload: Record<string, unknown>,
  searchId: string | undefined,
): QueritContentsResponse {
  if (!Array.isArray(payload.results) || !Array.isArray(payload.statuses)) {
    throw new QueritApiError(
      withSearchId("Querit contents response is missing results or statuses.", searchId),
      { searchId },
    );
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
      highlights: stringList(rawResult.highlights),
      metadata,
    });
  }

  const statuses = payload.statuses.filter(isRecord).map((status) => ({
    id: optionalString(status.id),
    status: optionalString(status.status),
  }));

  return {
    searchId,
    results: [...deduplicated.values()],
    statuses,
    searchTime: optionalNumber(payload.searchTime),
    cost: normalizeCost(payload.cost),
  };
}

/** Reads `cost`, keeping Querit's "absent means unavailable" distinct from a reported zero. */
function normalizeCost(value: unknown): QueritCost | undefined {
  if (!isRecord(value) || typeof value.currency !== "string") return undefined;
  const total = optionalNumber(value.total);
  if (total === undefined || total < 0) return undefined;
  return { currency: value.currency, total };
}

/** Renders a cost at the API's six-decimal precision so small charges stay visible. */
export function formatCost(cost: QueritCost): string {
  return `${cost.currency} ${cost.total.toFixed(6)}`;
}

function extractSearchId(text: string): string | undefined {
  const match = /"search_id"\s*:\s*(?:"([^"]+)"|(-?\d+))/u.exec(text);
  const value = match?.[1] ?? match?.[2];
  return value && /^-?\d+$/u.test(value) ? value : undefined;
}

function normalizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new QueritApiError("Querit base URL must be a valid HTTP(S) URL.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new QueritApiError("Querit base URL must be an HTTP(S) URL without embedded credentials.");
  }
  return url.toString().replace(/\/+$/u, "");
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Reads an optional string array, dropping anything that is not a string. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Like stringList, but keeps "the API omitted this field" distinct from an empty list. */
function optionalStringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? stringList(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
