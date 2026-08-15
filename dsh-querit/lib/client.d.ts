export declare const QUERIT_API_BASE_URL = "https://api.querit.ai";
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 70000;
export interface QueritSearchRequest {
    query: string;
    count: number;
    chunksPerDoc?: number;
    needContent?: boolean;
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
export interface QueritContentResult {
    id?: string;
    url: string;
    content: string;
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
export declare class QueritApiError extends Error {
    readonly status?: number;
    readonly searchId?: string;
    constructor(message: string, options?: {
        status?: number;
        searchId?: string;
        cause?: unknown;
    });
}
export declare class QueritClient {
    private readonly apiKey;
    private readonly fetchImpl;
    private readonly baseUrl;
    private readonly timeoutMs;
    constructor(options: QueritClientOptions);
    search(request: QueritSearchRequest, signal?: AbortSignal): Promise<QueritSearchResponse>;
    contents(request: QueritContentsRequest, signal?: AbortSignal): Promise<QueritContentsResponse>;
    private postJson;
}
