import { WebError } from "@deepseek-ai/dsh-web";
import { DEFAULT_REQUEST_TIMEOUT_MS, QueritApiError, QueritClient, } from "./client.js";
/** Stable id both providers register under. */
export const QUERIT_PROVIDER_ID = "querit";
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
];
/** `dN`/`wN`/`mN`/`yN` (N ≥ 1) or an inclusive `YYYY-MM-DDtoYYYY-MM-DD` range. */
export const TIME_RANGE_PATTERN = /^(?:[dwmy][1-9][0-9]*|\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2})$/u;
/** Cap on one source's merged snippet + sentence excerpts, in chars. */
const SNIPPET_MAX_CHARS = 4_096;
export function isTimeRange(value) {
    return typeof value === "string" && TIME_RANGE_PATTERN.test(value.trim());
}
/**
 * Normalize a configured hostname list: lowercase, drop schemes/ports/paths,
 * and keep at most 100 unique entries. Invalid entries are dropped.
 */
export function normalizeDomains(values) {
    const domains = new Set();
    for (const entry of values ?? []) {
        const host = normalizeHostname(entry);
        if (host)
            domains.add(host);
        if (domains.size >= 100)
            break;
    }
    return [...domains];
}
export function normalizeHostname(value) {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed)
        return undefined;
    const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    let url;
    try {
        url = new URL(candidate);
    }
    catch {
        return undefined;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
        return undefined;
    const host = url.hostname.toLowerCase();
    if (!host || host.length > 253 || !host.includes("."))
        return undefined;
    return host;
}
function clampInteger(value, min, max) {
    return Math.min(max, Math.max(min, Math.trunc(value)));
}
function mergeSnippet(result) {
    const parts = [];
    if (result.snippet.trim())
        parts.push(result.snippet.trim());
    for (const sentence of result.sentences) {
        const trimmed = sentence.trim();
        if (trimmed)
            parts.push(`- ${trimmed}`);
    }
    const merged = parts.join("\n");
    return merged.length <= SNIPPET_MAX_CHARS ? merged : `${merged.slice(0, SNIPPET_MAX_CHARS - 3)}...`;
}
export class QueritSearchProvider {
    resolveOptions;
    id = QUERIT_PROVIDER_ID;
    /**
     * @param resolveOptions - options for the NEXT operation, snapshotted once
     * at each operation's entry so one search never mixes two settings sections.
     */
    constructor(resolveOptions) {
        this.resolveOptions = resolveOptions;
    }
    available() {
        const options = this.resolveOptions();
        if (!URL.canParse(options.baseURL))
            return false;
        if ((options.apiKey?.length ?? 0) === 0 && options.resolveApiKey === undefined)
            return false;
        if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000)
            return false;
        if (!Number.isInteger(options.count) || options.count < 1 || options.count > 20)
            return false;
        if (!Number.isInteger(options.chunksPerDoc) || options.chunksPerDoc < 1 || options.chunksPerDoc > 3)
            return false;
        if (options.timeRange !== undefined && !isTimeRange(options.timeRange))
            return false;
        return true;
    }
    async search(request, signal) {
        throwIfAborted(signal);
        const options = this.resolveOptions();
        const client = await this.client(options, signal);
        const filters = {};
        if (options.includeDomains.length > 0 || options.excludeDomains.length > 0) {
            filters.sites = {
                ...(options.includeDomains.length > 0 ? { include: options.includeDomains } : {}),
                ...(options.excludeDomains.length > 0 ? { exclude: options.excludeDomains } : {}),
            };
        }
        if (options.timeRange)
            filters.timeRange = { date: options.timeRange };
        if (options.countries.length > 0)
            filters.geo = { countries: { include: options.countries } };
        if (options.languages.length > 0)
            filters.languages = { include: options.languages };
        const count = clampInteger(request.maxResults ?? options.count, 1, 20);
        let response;
        try {
            response = await client.search({
                query: request.query,
                count,
                chunksPerDoc: options.chunksPerDoc,
                needContent: options.includeContent,
                ...(Object.keys(filters).length === 0 ? {} : { filters }),
            }, signal);
        }
        catch (error) {
            if (signal?.aborted === true || isAbortError(error))
                throw aborted(signal, error);
            throw new WebError(`Querit search failed: ${errorMessage(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
        }
        const sources = response.results.map((result) => ({
            url: result.url,
            ...(result.title && result.title !== result.url ? { title: result.title } : {}),
            ...(mergeSnippet(result) ? { snippet: mergeSnippet(result) } : {}),
            ...(result.pageAge ? { publishedAt: result.pageAge } : {}),
        }));
        return { sources, truncated: false };
    }
    async client(options, signal) {
        throwIfAborted(signal);
        let apiKey = options.apiKey;
        if (apiKey === undefined || apiKey.length === 0) {
            let resolved;
            try {
                resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal);
            }
            catch (error) {
                if (signal?.aborted === true || isAbortError(error))
                    throw aborted(signal, error);
                throw new WebError(`Querit credential resolution failed: ${errorMessage(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
            }
            apiKey = resolved;
        }
        if (apiKey === undefined || apiKey.length === 0) {
            throw new WebError(`Querit has no API key for "${options.apiKeyEnv ?? "QUERIT_API_KEY"}". Configure it in priority order: export it in the launching environment, add it to the credentials store ($DSH_HOME/.credentials.yaml), or set a literal "apiKey" on the web-search-querit row. See the dsh-querit README for details.`, "WEB_PROVIDER_CREDENTIAL_MISSING");
        }
        return options.clientFactory?.({ apiKey, baseUrl: options.baseURL, timeoutMs: options.timeoutMs })
            ?? new QueritClient({ apiKey, baseUrl: options.baseURL, timeoutMs: options.timeoutMs });
    }
}
export class QueritFetchProvider {
    resolveOptions;
    id = QUERIT_PROVIDER_ID;
    constructor(resolveOptions) {
        this.resolveOptions = resolveOptions;
    }
    available() {
        const options = this.resolveOptions();
        if (!URL.canParse(options.baseURL))
            return false;
        if ((options.apiKey?.length ?? 0) === 0 && options.resolveApiKey === undefined)
            return false;
        if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000)
            return false;
        if (!Number.isInteger(options.fetchCrawlTimeout) || options.fetchCrawlTimeout < 1 || options.fetchCrawlTimeout > 60)
            return false;
        if (!Number.isInteger(options.fetchMaxChars) || options.fetchMaxChars < 256)
            return false;
        return true;
    }
    async fetch(request, signal) {
        throwIfAborted(signal);
        const options = this.resolveOptions();
        const client = await this.client(options, signal);
        let response;
        try {
            response = await client.contents({
                urls: [request.url],
                format: options.fetchFormat,
                crawlTimeout: options.fetchCrawlTimeout,
                extrasMeta: false,
            }, signal);
        }
        catch (error) {
            if (signal?.aborted === true || isAbortError(error))
                throw aborted(signal, error);
            throw new WebError(`Querit fetch failed: ${errorMessage(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
        }
        const succeeded = response.statuses.some((status) => status.status === "success");
        const result = response.results.find((item) => item.content.length > 0) ?? response.results[0];
        if (succeeded && result !== undefined && result.content.length > 0) {
            const truncated = result.content.length > options.fetchMaxChars;
            const content = truncated ? `${result.content.slice(0, options.fetchMaxChars - 3)}...` : result.content;
            return {
                url: result.url,
                statusCode: 200,
                body: { kind: options.fetchFormat === "html" ? "html" : "text", content },
                truncated,
            };
        }
        const failed = response.statuses.find((status) => status.status !== undefined && status.status !== "success");
        throw new WebError(failed ? `Querit could not retrieve the page: ${failed.status}` : "Querit returned no content for the requested URL.", "WEB_PROVIDER_ERROR");
    }
    async client(options, signal) {
        throwIfAborted(signal);
        let apiKey = options.apiKey;
        if (apiKey === undefined || apiKey.length === 0) {
            let resolved;
            try {
                resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal);
            }
            catch (error) {
                if (signal?.aborted === true || isAbortError(error))
                    throw aborted(signal, error);
                throw new WebError(`Querit credential resolution failed: ${errorMessage(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
            }
            apiKey = resolved;
        }
        if (apiKey === undefined || apiKey.length === 0) {
            throw new WebError(`Querit has no API key for "${options.apiKeyEnv ?? "QUERIT_API_KEY"}". Configure it in priority order: export it in the launching environment, add it to the credentials store ($DSH_HOME/.credentials.yaml), or set a literal "apiKey" on the web-search-querit row. See the dsh-querit README for details.`, "WEB_PROVIDER_CREDENTIAL_MISSING");
        }
        return options.clientFactory?.({ apiKey, baseUrl: options.baseURL, timeoutMs: options.timeoutMs })
            ?? new QueritClient({ apiKey, baseUrl: options.baseURL, timeoutMs: options.timeoutMs });
    }
}
/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable(operation, signal) {
    if (signal === undefined)
        return operation;
    if (signal.aborted)
        return Promise.reject(aborted(signal));
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(aborted(signal));
        signal.addEventListener("abort", onAbort, { once: true });
        operation.then((value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener("abort", onAbort);
            reject(new Error(errorMessage(error), { cause: error }));
        });
    });
}
/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfAborted(signal) {
    if (signal?.aborted === true)
        throw aborted(signal);
}
/** Build the provider's stable cancellation error while retaining the caller's reason. */
function aborted(signal, fallback) {
    return new WebError("Querit request aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
    return error instanceof DOMException && error.name === "AbortError";
}
function errorMessage(error) {
    if (error instanceof QueritApiError)
        return error.message;
    return error instanceof Error ? error.message : String(error);
}
