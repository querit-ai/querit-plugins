/** Per-operation deadline, retries and backoff waits included. */
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 70000;
export declare const QUERIT_API_BASE_URL = "https://api.querit.ai";
/** Largest `count` the API accepts. */
export declare const QUERIT_COUNT_LIMIT = 100;
/** Largest `contentMaxChars` the API accepts. */
export declare const QUERIT_CONTENT_MAX_CHARS_LIMIT = 1000000;
/** The values `filters.vertical`, `rank.preference`, and `filters.resourceTags.include[]` accept. */
export declare const VERTICAL_VALUES: readonly ["code", "finance"];
export declare const RANK_VALUES: readonly ["relevance", "freshness"];
export declare const RESOURCE_TAG_VALUES: readonly ["qa", "github"];
export type QueritVertical = (typeof VERTICAL_VALUES)[number];
export type QueritRankPreference = (typeof RANK_VALUES)[number];
export type QueritResourceTag = (typeof RESOURCE_TAG_VALUES)[number];
interface QueritHighlights {
    /** Guides the extraction; Querit falls back to the top-level query when omitted. */
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
            include?: QueritResourceTag[];
        };
    };
}
export interface QueritContentsRequest {
    urls: string[];
    format: "text" | "markdown" | "html";
    crawlTimeout: number;
    extrasMeta: boolean;
    /** Content limit per URL. Omit for the full available content. */
    contentMaxChars?: number;
    highlights?: QueritHighlights;
}
interface QueritCost {
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
    errorCode?: string;
    errorMessage?: string;
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
    highlights: string[];
    metadata?: QueritContentMetadata;
}
interface QueritContentStatus {
    id?: string;
    status?: string;
}
export interface QueritContentsResponse {
    errorCode?: string;
    errorMessage?: string;
    searchId?: string;
    searchTime?: number;
    /** Absent means unavailable, never "free". */
    cost?: QueritCost;
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
    /**
     * Marks an API failure with its status and Retry-After so postJson can decide whether to
     * retry, and puts search_id in the message: support needs it to trace the request.
     */
    private apiError;
}
/** Parses `Retry-After` in both forms the HTTP spec allows: delay-seconds or an HTTP-date. */
export declare function parseRetryAfter(value: string | null, now?: number): number | undefined;
/** Renders a cost at the API's six-decimal precision so small charges stay visible. */
export declare function formatCost(cost: QueritCost): string;
export {};
