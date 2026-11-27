/**
 * Credential-safe client for the public Querit API
 * (`POST https://api.querit.ai/v1/search` and `/v1/contents`).
 * Structure follows the client shipped by pi-querit (MIT):
 * response-size limits, deduplication, URL normalization, API-key
 * redaction from every error surface, and retries for the statuses
 * Querit documents as transient.
 * @module dsh-querit/client
 */
import { sanitizeErrorMessage, sanitizeUntrustedText } from "./sanitize.js";
const SEARCH_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const CONTENTS_RESPONSE_MAX_BYTES = 10 * 1024 * 1024;
const ERROR_RESPONSE_MAX_BYTES = 8 * 1024;
/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = "dsh-querit/2.0.0";
/** Querit documents these as the only statuses worth retrying; never 400, 401, 403, or 404. */
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
/** Per-operation deadline, retries and backoff waits included. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 70_000;
export const QUERIT_API_BASE_URL = "https://api.querit.ai";
/** Largest `count` the API accepts. */
export const QUERIT_COUNT_LIMIT = 100;
/** Largest `contentMaxChars` the API accepts. */
export const QUERIT_CONTENT_MAX_CHARS_LIMIT = 1_000_000;
/** The values `filters.vertical`, `rank.preference`, and `filters.resourceTags.include[]` accept. */
export const VERTICAL_VALUES = ["code", "finance"];
export const RANK_VALUES = ["relevance", "freshness"];
export const RESOURCE_TAG_VALUES = ["qa", "github"];
const DEFAULT_RETRY = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5_000 };
export class QueritApiError extends Error {
    status;
    searchId;
    /** Wait the server asked for through `Retry-After`, when it sent one. */
    retryAfterMs;
    /** Requests sent before giving up, including the first. */
    attempts;
    constructor(message, options = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = "QueritApiError";
        this.status = options.status;
        this.searchId = options.searchId;
        this.retryAfterMs = options.retryAfterMs;
        this.attempts = options.attempts ?? 1;
    }
}
export class QueritClient {
    apiKey;
    fetchImpl;
    baseUrl;
    timeoutMs;
    retry;
    constructor(options) {
        const apiKey = options.apiKey.trim();
        if (!apiKey) {
            throw new QueritApiError("A Querit API key is required.");
        }
        this.apiKey = apiKey;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.baseUrl = (options.baseUrl ?? QUERIT_API_BASE_URL).replace(/\/+$/, "");
        this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.retry = { ...DEFAULT_RETRY, ...options.retry };
    }
    async search(request, signal) {
        const response = await this.postJson("/v1/search", request, SEARCH_RESPONSE_MAX_BYTES, signal);
        return normalizeSearchResponse(response.body, response.searchId, request.query);
    }
    async contents(request, signal) {
        const response = await this.postJson("/v1/contents", request, CONTENTS_RESPONSE_MAX_BYTES, signal);
        return normalizeContentsResponse(response.body, response.searchId);
    }
    /**
     * Posts the request, retrying the statuses Querit calls transient with bounded
     * exponential backoff and jitter. One deadline covers every attempt and wait.
     */
    async postJson(path, requestBody, responseLimit, callerSignal) {
        const deadline = AbortSignal.timeout(this.timeoutMs);
        const operation = {
            deadline,
            callerSignal,
            signal: callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline,
        };
        for (let attempt = 0;; attempt++) {
            let failure;
            try {
                return await this.attempt(path, requestBody, responseLimit, operation);
            }
            catch (error) {
                failure = error instanceof QueritApiError
                    ? error
                    : new QueritApiError(sanitizeErrorMessage(error), { cause: error });
            }
            // Cancellations and timeouts are reported as-is: they are not transient server states.
            const retryable = RETRYABLE_STATUSES.has(failure.status ?? 0);
            if (!retryable || attempt >= this.retry.maxRetries)
                throw withAttempts(failure, attempt + 1);
            const waitMs = retryDelayMs(failure.retryAfterMs, attempt, this.retry);
            if (waitMs === undefined) {
                // Honor an over-long Retry-After by not retrying sooner.
                throw withAttempts(new QueritApiError(`${failure.message} Querit asked to retry after ${Math.ceil((failure.retryAfterMs ?? 0) / 1_000)}s, `
                    + `longer than the ${this.retry.maxDelayMs} ms this client waits; not retried.`, { status: failure.status, searchId: failure.searchId, retryAfterMs: failure.retryAfterMs, cause: failure }), attempt + 1);
            }
            try {
                await sleep(waitMs, operation.signal);
            }
            catch (cancelled) {
                throw interrupted(cancelled, operation, this.timeoutMs, sanitizeErrorMessage(cancelled));
            }
        }
    }
    async attempt(path, requestBody, responseLimit, operation) {
        let response;
        try {
            response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${this.apiKey}`,
                    "User-Agent": USER_AGENT,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
                signal: operation.signal,
            });
        }
        catch (error) {
            throw interrupted(error, operation, this.timeoutMs, `Querit request failed: ${sanitizeErrorMessage(error)}`);
        }
        const bodyLimit = response.ok ? responseLimit : ERROR_RESPONSE_MAX_BYTES;
        let text;
        try {
            text = await readResponseText(response, bodyLimit);
        }
        catch (error) {
            throw interrupted(error, operation, this.timeoutMs, `Could not read the Querit response: ${sanitizeErrorMessage(error)}`, response.status);
        }
        const searchId = extractSearchId(text);
        let payload;
        try {
            payload = JSON.parse(text);
        }
        catch (error) {
            const excerpt = redactSecret(text.slice(0, 500), this.apiKey);
            if (!response.ok) {
                throw this.apiError(`Querit API request failed with HTTP ${response.status}${excerpt ? `: ${excerpt}` : "."}`, response, response.status, searchId, error);
            }
            throw new QueritApiError(`Querit returned invalid JSON${excerpt ? `: ${excerpt}` : "."}`, { status: response.status, searchId, cause: error });
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
        // Querit asks clients to check error_code even on an HTTP 200.
        if (!response.ok || (Number.isFinite(numericErrorCode) && numericErrorCode !== 200)) {
            // error_code is the request's own verdict; the HTTP status stands in when the body has none.
            const status = response.ok ? (numericErrorCode ?? response.status) : response.status;
            throw this.apiError(redactSecret(apiErrorMessage ?? `Querit API request failed with HTTP ${response.status}.`, this.apiKey), response, status, searchId);
        }
        return { body: payload, searchId };
    }
    /**
     * Marks an API failure with its status and Retry-After so postJson can decide whether to
     * retry, and puts search_id in the message: support needs it to trace the request.
     */
    apiError(message, response, status, searchId, cause) {
        const traced = searchId ? `${message} [search_id: ${searchId}]` : message;
        return new QueritApiError(traced, {
            status,
            searchId,
            retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
            cause,
        });
    }
}
/** Says how many requests a final failure took, when the first one was retried. */
function withAttempts(failure, attempts) {
    if (attempts <= 1)
        return failure;
    return new QueritApiError(`Querit request failed after ${attempts} attempts: ${failure.message}`, {
        status: failure.status,
        searchId: failure.searchId,
        retryAfterMs: failure.retryAfterMs,
        attempts,
        cause: failure,
    });
}
/**
 * Says when the caller cancelled or the deadline passed — neither is a transient
 * server state, so neither is retried — and otherwise reports `failure`.
 * `status` is the HTTP status, when a response had already arrived.
 */
function interrupted(error, operation, timeoutMs, failure, status) {
    if (operation.callerSignal?.aborted) {
        return new QueritApiError("Querit request was cancelled.", { status, cause: error });
    }
    if (operation.deadline.aborted) {
        return new QueritApiError(`Querit request timed out after ${timeoutMs} ms.`, { status, cause: error });
    }
    return new QueritApiError(failure, { status, cause: error });
}
function retryDelayMs(retryAfterMs, attempt, retry) {
    if (retryAfterMs !== undefined) {
        return retryAfterMs <= retry.maxDelayMs ? retryAfterMs : undefined;
    }
    // Equal jitter: half the ceiling plus a random half, so waits back off without clustering.
    const ceiling = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt);
    return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}
/** Parses `Retry-After` in both forms the HTTP spec allows: delay-seconds or an HTTP-date. */
export function parseRetryAfter(value, now = Date.now()) {
    if (value === null)
        return undefined;
    const trimmed = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        return Math.max(0, Math.ceil(Number(trimmed) * 1_000));
    }
    const date = Date.parse(trimmed);
    if (!Number.isFinite(date))
        return undefined;
    return Math.max(0, date - now);
}
function sleep(ms, signal) {
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
async function readResponseText(response, maxBytes) {
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
    const chunks = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel("response size limit exceeded");
                throw new Error(`response exceeds the ${maxBytes}-byte limit`);
            }
            chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
        return chunks.join("");
    }
    finally {
        reader.releaseLock();
    }
}
function normalizeSearchResponse(payload, searchId, requestedQuery) {
    const resultsContainer = payload.results;
    if (!isRecord(resultsContainer) || !Array.isArray(resultsContainer.result)) {
        throw new QueritApiError("Querit search response is missing results.result.", { searchId });
    }
    const deduplicated = new Map();
    for (const rawItem of resultsContainer.result) {
        if (!isRecord(rawItem))
            continue;
        const url = normalizeHttpUrl(rawItem.url);
        // Every result field is optional; a result without a usable URL cannot be cited.
        if (!url || deduplicated.has(url))
            continue;
        deduplicated.set(url, {
            title: optionalString(rawItem.title) ?? url,
            url,
            snippet: optionalString(rawItem.snippet) ?? "",
            pageAge: optionalString(rawItem.page_age),
            siteName: optionalString(rawItem.site_name),
            siteIcon: optionalString(rawItem.site_icon),
            sentences: stringList(rawItem.sentence),
            highlights: stringList(rawItem.highlights),
            snippetMarkdown: optionalStringList(rawItem.snippet_markdown),
            contentMarkdown: optionalString(rawItem.content_markdown),
        });
    }
    const queryContext = isRecord(payload.query_context) ? payload.query_context : undefined;
    return {
        errorCode: optionalString(payload.error_code),
        errorMessage: optionalString(payload.error_msg),
        searchId,
        took: optionalString(payload.took),
        cost: normalizeCost(payload.cost),
        query: queryContext ? optionalString(queryContext.query) ?? requestedQuery : requestedQuery,
        results: [...deduplicated.values()],
    };
}
function normalizeContentsResponse(payload, searchId) {
    if (!Array.isArray(payload.results) || !Array.isArray(payload.statuses)) {
        throw new QueritApiError("Querit contents response is missing results or statuses.", { searchId });
    }
    const deduplicated = new Map();
    for (const rawResult of payload.results) {
        if (!isRecord(rawResult))
            continue;
        const url = normalizeHttpUrl(rawResult.url);
        if (!url || deduplicated.has(url))
            continue;
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
    const statuses = payload.statuses
        .filter(isRecord)
        .map((status) => ({
        id: optionalString(status.id),
        status: optionalString(status.status),
    }));
    return {
        errorCode: optionalString(payload.error_code),
        errorMessage: optionalString(payload.error_msg),
        searchId,
        searchTime: optionalNumber(payload.searchTime),
        cost: normalizeCost(payload.cost),
        results: [...deduplicated.values()],
        statuses,
    };
}
/** Reads `cost`, keeping Querit's "absent means unavailable" distinct from a reported zero. */
function normalizeCost(value) {
    if (!isRecord(value) || typeof value.currency !== "string")
        return undefined;
    const total = optionalNumber(value.total);
    if (total === undefined || total < 0)
        return undefined;
    return { currency: value.currency, total };
}
/** Renders a cost at the API's six-decimal precision so small charges stay visible. */
export function formatCost(cost) {
    return `${cost.currency} ${cost.total.toFixed(6)}`;
}
function extractSearchId(text) {
    const match = /"search_id"\s*:\s*(?:"([^"]+)"|(-?\d+))/.exec(text);
    const value = match?.[1] ?? match?.[2];
    return value && /^-?\d+$/.test(value) ? value : undefined;
}
function normalizeHttpUrl(value) {
    if (typeof value !== "string")
        return undefined;
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:")
            return undefined;
        return url.toString();
    }
    catch {
        return undefined;
    }
}
function redactSecret(text, secret) {
    const redacted = secret ? text.split(secret).join("[REDACTED]") : text;
    return sanitizeUntrustedText(redacted);
}
function optionalString(value) {
    if (typeof value === "string")
        return value;
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    return undefined;
}
function optionalNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
/** Reads an optional string array, dropping anything that is not a string. */
function stringList(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
/** Like stringList, but keeps "the API omitted this field" distinct from an empty list. */
function optionalStringList(value) {
    return Array.isArray(value) ? stringList(value) : undefined;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
