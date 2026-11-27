export declare const QUERIT_API_BASE_URL = "https://api.querit.ai";
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 70000;
/** Largest `count` the API accepts. */
export declare const QUERIT_COUNT_LIMIT = 100;
/** Inclusive bounds of `highlights.maxCharacters`. */
export declare const QUERIT_HIGHLIGHT_MIN_CHARACTERS = 100;
export declare const QUERIT_HIGHLIGHT_MAX_CHARACTERS = 8000;
/** Largest `contentMaxChars` the API accepts. */
export declare const QUERIT_CONTENT_MAX_CHARS_LIMIT = 1000000;
/** Most URLs one /v1/contents request accepts. */
export declare const QUERIT_URLS_LIMIT = 10;
/** Inclusive bounds of `crawlTimeout`, in seconds. */
export declare const QUERIT_CRAWL_TIMEOUT_MIN_SECONDS = 1;
export declare const QUERIT_CRAWL_TIMEOUT_MAX_SECONDS = 60;
export declare const FETCH_FORMAT_VALUES: readonly ["text", "markdown", "html"];
export type QueritFetchFormat = (typeof FETCH_FORMAT_VALUES)[number];
export declare const VERTICAL_VALUES: readonly ["code", "finance"];
export type QueritVertical = (typeof VERTICAL_VALUES)[number];
export declare const RANK_VALUES: readonly ["relevance", "freshness"];
export type QueritRankPreference = (typeof RANK_VALUES)[number];
export declare const RESOURCE_TAG_VALUES: readonly ["qa", "github"];
export type QueritResourceTag = (typeof RESOURCE_TAG_VALUES)[number];
export declare const COUNTRY_VALUES: readonly ["argentina", "australia", "brazil", "canada", "colombia", "france", "germany", "india", "indonesia", "japan", "mexico", "nigeria", "philippines", "south korea", "spain", "united kingdom", "united states"];
export type QueritCountry = (typeof COUNTRY_VALUES)[number];
export declare const LANGUAGE_VALUES: readonly ["english", "japanese", "korean", "german", "french", "spanish", "portuguese", "russian"];
export type QueritLanguage = (typeof LANGUAGE_VALUES)[number];
export interface QueritHighlights {
    /** Guides the extraction; for search, Querit falls back to the top-level query when omitted. */
    query?: string;
    maxCharacters?: number;
}
export interface QueritSearchRequest {
    query: string;
    /** Omit to let Querit apply its server default. */
    count?: number;
    /** Deprecated by Querit in favor of `highlights`. Send only when a user explicitly configured it. */
    chunksPerDoc?: number;
    highlights?: boolean | QueritHighlights;
    needContent?: boolean;
    /** Body-text limit per result; only meaningful together with `needContent: true`. */
    contentMaxChars?: number;
    /** Enterprise only; ignored by Querit on other plans. */
    needMarkdown?: boolean;
    /** Returns 400 when combined with `filters.vertical: "code"`. */
    rank?: {
        preference: QueritRankPreference;
    };
    filters?: {
        sites?: {
            include?: string[];
            exclude?: string[];
        };
        timeRange?: {
            date: string;
        };
        geo?: {
            countries: {
                include: string[];
            };
        };
        languages?: {
            include: string[];
        };
        vertical?: QueritVertical;
        /** Sub-tags of a vertical. Only `qa` and `github`, on the code vertical, are documented. */
        resourceTags?: {
            include: QueritResourceTag[];
        };
    };
}
export interface QueritContentsRequest {
    urls: string[];
    format: QueritFetchFormat;
    crawlTimeout: number;
    extrasMeta: boolean;
    /** Content limit per URL. Omit for the full available content. */
    contentMaxChars?: number;
    highlights?: QueritHighlights;
}
export interface QueritCost {
    /** Querit always reports "USD". */
    currency: string;
    /** Charge in dollars with up to six decimal places; 0 is a reported zero charge. */
    total: number;
}
interface QueritSearchResult {
    title: string;
    url: string;
    snippet: string;
    pageAge?: string;
    siteName?: string;
    siteIcon?: string;
    /** Body text, present only when `needContent: true` was requested and is available. */
    sentences: string[];
    /** Query-focused fragments, present only when `highlights` was requested and is available. */
    highlights: string[];
    /** Markdown versions. Omitted unless `needMarkdown: true` was requested on an Enterprise plan. */
    snippetMarkdown?: string[];
    contentMarkdown?: string;
}
export interface QueritSearchResponse {
    searchId?: string;
    took?: string;
    /** Absent means unavailable, never "free". */
    cost?: QueritCost;
    query: string;
    results: QueritSearchResult[];
}
interface QueritContentMetadata {
    title?: string;
    url?: string;
    publishTime?: string;
    siteName?: string;
    siteIcon?: string;
}
interface QueritContentResult {
    id?: string;
    url: string;
    content: string;
    /** Query-focused fragments, present only when `highlights` was requested and is available. */
    highlights: string[];
    metadata?: QueritContentMetadata;
}
interface QueritContentStatus {
    id?: string;
    status?: string;
}
export interface QueritContentsResponse {
    searchId?: string;
    /** Absent means unavailable, never "free". */
    cost?: QueritCost;
    searchTime?: number;
    results: QueritContentResult[];
    statuses: QueritContentStatus[];
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
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    /** Deadline for the whole operation, retries and backoff waits included. */
    timeoutMs?: number;
    retry?: Partial<QueritRetryOptions>;
}
export declare class QueritApiError extends Error {
    readonly status?: number;
    readonly searchId?: string;
    /** Wait the server asked for through `Retry-After`, when it sent one. */
    readonly retryAfterMs?: number;
    /** Requests sent before giving up, including the first. */
    readonly attempts: number;
    constructor(message: string, options?: {
        status?: number;
        searchId?: string;
        retryAfterMs?: number;
        attempts?: number;
        cause?: unknown;
    });
}
export declare class QueritClient {
    private readonly apiKey;
    private readonly fetchImpl;
    private readonly baseUrl;
    private readonly timeoutMs;
    private readonly retry;
    constructor(options: QueritClientOptions);
    search(request: QueritSearchRequest, signal?: AbortSignal): Promise<QueritSearchResponse>;
    contents(request: QueritContentsRequest, signal?: AbortSignal): Promise<QueritContentsResponse>;
    /**
     * Posts the request, retrying the statuses Querit calls transient with bounded
     * exponential backoff and jitter. One deadline covers every attempt and wait.
     */
    private postJson;
    private attempt;
}
/** Parses `Retry-After` in both forms the HTTP spec allows: delay-seconds or an HTTP-date. */
export declare function parseRetryAfter(value: string | null, now?: number): number | undefined;
/** Renders a cost at the API's six-decimal precision so small charges stay visible. */
export declare function formatCost(cost: QueritCost): string;
export {};
