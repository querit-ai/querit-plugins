/**
 * Plugin option resolution for opencode-querit. Raw options come from the
 * `["opencode-querit", { ... }]` tuple in `opencode.json` (or a local plugin
 * file); every value is validated, normalized, and defaulted here so the
 * tools only ever see a fully resolved `QueritConfig`.
 *
 * API-key resolution happens per tool call in priority order: a literal
 * `apiKey` option, then the environment variable named by `apiKeyEnv`
 * (default `QUERIT_API_KEY`).
 * @module opencode-querit/config
 */
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
export const DEFAULT_API_KEY_ENV = "QUERIT_API_KEY";
export const BASE_URL_ENV = "QUERIT_BASE_URL";
export const DEFAULT_COUNT = 5;
export const DEFAULT_TIMEOUT_MS = 70_000;
export const DEFAULT_CHUNKS_PER_DOC = 1;
export const DEFAULT_FETCH_FORMAT = "markdown";
export const DEFAULT_FETCH_CRAWL_TIMEOUT = 10;
export const DEFAULT_FETCH_MAX_CHARS = 8_000;
export const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
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
/**
 * Resolve raw plugin options (plus environment fallbacks) into a fully
 * defaulted `QueritConfig`. Throws a descriptive error on any invalid value
 * so a misconfigured `opencode.json` fails the tool call loudly instead of
 * silently changing behavior.
 */
export function resolveConfig(options = {}, env = process.env) {
    const apiKeyEnv = (options.apiKeyEnv ?? DEFAULT_API_KEY_ENV).trim();
    if (!apiKeyEnv)
        throw new Error("apiKeyEnv must be a non-empty environment variable name.");
    const literalApiKey = options.apiKey !== undefined && options.apiKey.trim().length > 0
        ? options.apiKey.trim()
        : undefined;
    const baseURL = (options.baseURL?.trim() || env[BASE_URL_ENV]?.trim() || "https://api.querit.ai").replace(/\/+$/, "");
    if (!URL.canParse(baseURL)) {
        throw new Error(`baseURL must be a parseable HTTP(S) URL: ${baseURL}`);
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
        throw new Error("timeoutMs must be an integer of at least 1000 ms.");
    }
    const count = options.count ?? DEFAULT_COUNT;
    if (!Number.isInteger(count) || count < 1 || count > 20) {
        throw new Error("count must be an integer between 1 and 20.");
    }
    const chunksPerDoc = options.chunksPerDoc ?? DEFAULT_CHUNKS_PER_DOC;
    if (!Number.isInteger(chunksPerDoc) || chunksPerDoc < 1 || chunksPerDoc > 3) {
        throw new Error("chunksPerDoc must be an integer between 1 and 3.");
    }
    const fetchFormat = options.fetchFormat ?? DEFAULT_FETCH_FORMAT;
    if (fetchFormat !== "text" && fetchFormat !== "markdown" && fetchFormat !== "html") {
        throw new Error(`fetchFormat must be one of: text, markdown, html (got: ${fetchFormat}).`);
    }
    const fetchCrawlTimeout = options.fetchCrawlTimeout ?? DEFAULT_FETCH_CRAWL_TIMEOUT;
    if (!Number.isInteger(fetchCrawlTimeout) || fetchCrawlTimeout < 1 || fetchCrawlTimeout > 60) {
        throw new Error("fetchCrawlTimeout must be an integer between 1 and 60 seconds.");
    }
    const fetchMaxChars = options.fetchMaxChars ?? DEFAULT_FETCH_MAX_CHARS;
    if (!Number.isInteger(fetchMaxChars) || fetchMaxChars < 256) {
        throw new Error("fetchMaxChars must be an integer of at least 256 chars.");
    }
    const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    if (!Number.isInteger(maxOutputChars) || maxOutputChars < 256) {
        throw new Error("maxOutputChars must be an integer of at least 256 chars.");
    }
    const timeRange = options.timeRange?.trim();
    if (timeRange !== undefined && timeRange.length > 0 && !isTimeRange(timeRange)) {
        throw new Error("timeRange must be a relative range (d7, w2, m3, y1, ...) or YYYY-MM-DDtoYYYY-MM-DD.");
    }
    return {
        ...(literalApiKey === undefined ? {} : { apiKey: literalApiKey }),
        apiKeyEnv,
        baseURL,
        timeoutMs,
        count,
        ...(timeRange === undefined || timeRange.length === 0 ? {} : { timeRange }),
        countries: normalizeEnumList(options.countries, COUNTRY_VALUES, "countries"),
        languages: normalizeEnumList(options.languages, LANGUAGE_VALUES, "languages"),
        includeDomains: normalizeDomains(options.includeDomains),
        excludeDomains: normalizeDomains(options.excludeDomains),
        includeContent: options.includeContent ?? false,
        chunksPerDoc,
        fetchFormat,
        fetchCrawlTimeout,
        fetchMaxChars,
        maxOutputChars,
    };
}
/** Resolve the Querit API key for one operation: literal option, then `apiKeyEnv`. */
export function resolveQueritApiKey(config, env = process.env) {
    if (config.apiKey !== undefined && config.apiKey.length > 0)
        return config.apiKey;
    const ambient = env[config.apiKeyEnv]?.trim();
    return ambient !== undefined && ambient.length > 0 ? ambient : undefined;
}
function normalizeEnumList(values, allowed, field) {
    if (values === undefined)
        return [];
    const allowedSet = new Set(allowed);
    const unknown = [...new Set(values.map((value) => value.trim().toLowerCase()))].filter((value) => !allowedSet.has(value));
    if (unknown.length > 0) {
        throw new Error(`${field} contains unsupported values: ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}.`);
    }
    return [...new Set(values.map((value) => value.trim().toLowerCase()))];
}
