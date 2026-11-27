/**
 * Credential-safe client for the public Querit API
 * (`POST https://api.querit.ai/v1/search` and `/v1/contents`).
 * Structure follows the client shipped by pi-querit / dsh-querit (MIT):
 * response-size limits, deduplication, URL normalization, bounded retries for
 * the statuses Querit calls transient, and API-key redaction from every error
 * surface.
 * @module opencode-querit/client
 */
import { sanitizeErrorMessage, sanitizeUntrustedText } from "./sanitize.js";
const SEARCH_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const CONTENTS_RESPONSE_MAX_BYTES = 10 * 1024 * 1024;
const ERROR_RESPONSE_MAX_BYTES = 8 * 1024;
/** Querit documents these as the only statuses worth retrying; never 400, 401, 403, or 404. */
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
export const QUERIT_API_BASE_URL = "https://api.querit.ai";
export const DEFAULT_REQUEST_TIMEOUT_MS = 70_000;
/** Largest `count` the API accepts. */
export const QUERIT_COUNT_LIMIT = 100;
/** Inclusive bounds of `highlights.maxCharacters`. */
export const QUERIT_HIGHLIGHT_MIN_CHARACTERS = 100;
export const QUERIT_HIGHLIGHT_MAX_CHARACTERS = 8_000;
/** Largest `contentMaxChars` the API accepts. */
export const QUERIT_CONTENT_MAX_CHARS_LIMIT = 1_000_000;
/** Most URLs one /v1/contents request accepts. */
export const QUERIT_URLS_LIMIT = 10;
/** Inclusive bounds of `crawlTimeout`, in seconds. */
export const QUERIT_CRAWL_TIMEOUT_MIN_SECONDS = 1;
export const QUERIT_CRAWL_TIMEOUT_MAX_SECONDS = 60;
export const FETCH_FORMAT_VALUES = ["text", "markdown", "html"];
export const VERTICAL_VALUES = ["code", "finance"];
export const RANK_VALUES = ["relevance", "freshness"];
export const RESOURCE_TAG_VALUES = ["qa", "github"];
export const COUNTRY_VALUES = [
    "argentina",
    "australia",
    "brazil",
    "canada",
    "colombia",
    "france",
    "germany",
    "india",
    "indonesia",
    "japan",
    "mexico",
    "nigeria",
    "philippines",
    "south korea",
    "spain",
    "united kingdom",
    "united states",
];
export const LANGUAGE_VALUES = [
    "english",
    "japanese",
    "korean",
    "german",
    "french",
    "spanish",
    "portuguese",
    "russian",
];
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
        const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
        const operation = { signal, callerSignal, deadline, timeoutMs: this.timeoutMs };
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
            // A cancelled or timed-out operation is reported as such: it is not a transient server state.
            if (signal.aborted)
                throw interrupted(failure, operation, () => failure, failure.status);
            if (!RETRYABLE_STATUSES.has(failure.status ?? 0) || attempt >= this.retry.maxRetries) {
                throw withAttempts(failure, attempt + 1);
            }
            const waitMs = retryDelayMs(failure.retryAfterMs, attempt, this.retry);
            if (waitMs === undefined) {
                // Honor an over-long Retry-After by not retrying sooner.
                throw withAttempts(new QueritApiError(`${failure.message} Querit asked to retry after ${Math.ceil((failure.retryAfterMs ?? 0) / 1_000)}s, `
                    + `longer than the ${this.retry.maxDelayMs} ms this client waits; not retried.`, { status: failure.status, searchId: failure.searchId, retryAfterMs: failure.retryAfterMs, cause: failure }), attempt + 1);
            }
            try {
                await sleep(waitMs, signal);
            }
            catch (cancelled) {
                throw interrupted(cancelled, operation, (cause) => new QueritApiError(sanitizeErrorMessage(cause), { cause }));
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
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
                signal: operation.signal,
            });
        }
        catch (error) {
            throw interrupted(error, operation, transportFailure("Querit request failed"));
        }
        const bodyLimit = response.ok ? responseLimit : ERROR_RESPONSE_MAX_BYTES;
        let text;
        try {
            text = await readResponseText(response, bodyLimit);
        }
        catch (error) {
            throw interrupted(error, operation, transportFailure("Could not read the Querit response"), response.status);
        }
        const searchId = extractSearchId(text);
        let payload;
        try {
            payload = JSON.parse(text);
        }
        catch (error) {
            const excerpt = redactSecret(text.slice(0, 500), this.apiKey);
            throw apiError(!response.ok
                ? `Querit API request failed with HTTP ${response.status}${excerpt ? `: ${excerpt}` : "."}`
                : `Querit returned invalid JSON${excerpt ? `: ${excerpt}` : "."}`, response, response.status, searchId, error);
        }
        if (!isRecord(payload)) {
            throw apiError("Querit returned an invalid response object.", response, response.status, searchId);
        }
        // Querit asks clients to check error_code even on an HTTP 200: it is the verdict, and on
        // a 200 it is the only thing that names the failure.
        const status = response.ok ? (numericCode(payload.error_code) ?? response.status) : response.status;
        if (status !== 200) {
            throw apiError(redactSecret(optionalString(payload.error_msg) || `Querit API request failed with HTTP ${response.status}.`, this.apiKey), response, status, searchId);
        }
        return { body: payload, searchId };
    }
}
/**
 * Marks an API failure with the status that decides retries and the `Retry-After`
 * the server sent.
 */
function apiError(message, response, status, searchId, cause) {
    return new QueritApiError(withSearchId(message, searchId), {
        status,
        searchId,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
        cause,
    });
}
/** Puts `search_id` in a failure message: support traces a request with it. */
function withSearchId(message, searchId) {
    return searchId ? `${message} [search_id: ${searchId}]` : message;
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
 * Maps a rejected transport step to the failure the caller sees. A cancellation or
 * timeout is reported as such; anything else becomes whatever `failure` builds.
 */
function interrupted(error, operation, failure, status) {
    if (operation.callerSignal?.aborted) {
        return new QueritApiError("Querit request was cancelled.", { status, cause: error });
    }
    if (operation.deadline.aborted) {
        return new QueritApiError(`Querit request timed out after ${operation.timeoutMs} ms.`, { status, cause: error });
    }
    return failure(error);
}
function transportFailure(reason, status) {
    return (cause) => new QueritApiError(`${reason}: ${sanitizeErrorMessage(cause)}`, { status, cause });
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
        throw new QueritApiError(withSearchId("Querit search response is missing results.result.", searchId), { searchId });
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
        searchId,
        took: optionalString(payload.took),
        cost: normalizeCost(payload.cost),
        query: queryContext ? optionalString(queryContext.query) ?? requestedQuery : requestedQuery,
        results: [...deduplicated.values()],
    };
}
function normalizeContentsResponse(payload, searchId) {
    if (!Array.isArray(payload.results) || !Array.isArray(payload.statuses)) {
        throw new QueritApiError(withSearchId("Querit contents response is missing results or statuses.", searchId), { searchId });
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
        searchId,
        cost: normalizeCost(payload.cost),
        searchTime: optionalNumber(payload.searchTime),
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
    return `${sanitizeUntrustedText(cost.currency).replace(/\s+/g, " ").trim()} ${cost.total.toFixed(6)}`;
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
/** Reads `error_code`: an integer, which a looser server may send as a numeric string. */
function numericCode(value) {
    if (typeof value === "number")
        return Number.isFinite(value) ? value : undefined;
    if (typeof value === "string" && /^-?\d+$/u.test(value.trim()))
        return Number(value);
    return undefined;
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
