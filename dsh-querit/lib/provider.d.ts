/**
 * Querit-backed `WebSearchProvider` and `WebFetchProvider` for the harness web
 * capability seam (`ctx.web`). Each search resolves the credential for the
 * NEXT operation, honors the caller's `AbortSignal`, maps failures to the
 * seam's `WebError` taxonomy, and never emits provider-generated answer text
 * as trusted `content` — only citeable sources.
 * @module dsh-querit/provider
 */
import type { WebFetchProvider, WebFetchResult, WebSearchProvider, WebSearchResult } from "@deepseek-ai/dsh-web";
import type { CredentialRef } from "@deepseek-ai/dsh-credentials";
import { type QueritClientOptions, type QueritContentsRequest, type QueritContentsResponse, type QueritSearchRequest, type QueritSearchResponse } from "./client.js";
/** Stable id both providers register under. */
export declare const QUERIT_PROVIDER_ID = "querit";
export declare const COUNTRY_VALUES: readonly ["argentina", "australia", "brazil", "canada", "colombia", "france", "germany", "india", "indonesia", "japan", "mexico", "nigeria", "philippines", "south korea", "spain", "united kingdom", "united states"];
export declare const LANGUAGE_VALUES: readonly ["english", "japanese", "korean", "german", "french", "spanish", "portuguese"];
/** `dN`/`wN`/`mN`/`yN` (N ≥ 1) or an inclusive `YYYY-MM-DDtoYYYY-MM-DD` range. */
export declare const TIME_RANGE_PATTERN: RegExp;
export interface QueritClientLike {
    search(request: QueritSearchRequest, signal?: AbortSignal): Promise<QueritSearchResponse>;
    contents(request: QueritContentsRequest, signal?: AbortSignal): Promise<QueritContentsResponse>;
}
export interface QueritProviderOptions {
    /** Literal Querit API key; when present it wins over `resolveApiKey`. */
    apiKey?: string;
    /** Resolve the current Querit API key for one operation. */
    resolveApiKey?: () => Promise<string | undefined>;
    /** Credential reference named by missing-credential diagnostics. */
    apiKeyEnv?: CredentialRef;
    /** Querit API base URL (`/v1/search` and `/v1/contents` are appended). */
    baseURL: string;
    /** Per-request timeout in ms. */
    timeoutMs: number;
    /** Result count used when the seam passes no `maxResults` bound. */
    count: number;
    /** Relative (`d7`, `m3`) or absolute date range filter. */
    timeRange?: string;
    /** Country bias list (validated against `COUNTRY_VALUES`). */
    countries: string[];
    /** Language filter list (validated against `LANGUAGE_VALUES`). */
    languages: string[];
    /** Whitelist hostnames; only these domains return results. */
    includeDomains: string[];
    /** Blacklist hostnames; these domains never return results. */
    excludeDomains: string[];
    /** Request sentence-level content excerpts (`needContent`). */
    includeContent: boolean;
    /** Content chunks per result, 1–3. */
    chunksPerDoc: number;
    /** Format requested from `/v1/contents` for fetch calls. */
    fetchFormat: "markdown" | "text" | "html";
    /** Per-page crawl timeout in seconds, 1–60. */
    fetchCrawlTimeout: number;
    /** Cap applied to one fetched page's decoded body, in chars. */
    fetchMaxChars: number;
    /** Client factory used by tests; defaults to `QueritClient`. */
    clientFactory?: (options: QueritClientOptions) => QueritClientLike;
}
export declare function isTimeRange(value: unknown): value is string;
/**
 * Normalize a configured hostname list: lowercase, drop schemes/ports/paths,
 * and keep at most 100 unique entries. Invalid entries are dropped.
 */
export declare function normalizeDomains(values: readonly string[] | undefined): string[];
export declare function normalizeHostname(value: string): string | undefined;
export declare class QueritSearchProvider implements WebSearchProvider {
    private readonly resolveOptions;
    readonly id = "querit";
    /**
     * @param resolveOptions - options for the NEXT operation, snapshotted once
     * at each operation's entry so one search never mixes two settings sections.
     */
    constructor(resolveOptions: () => QueritProviderOptions);
    available(): boolean;
    search(request: {
        query: string;
        maxResults?: number;
    }, signal?: AbortSignal): Promise<WebSearchResult>;
    private client;
}
export declare class QueritFetchProvider implements WebFetchProvider {
    private readonly resolveOptions;
    readonly id = "querit";
    constructor(resolveOptions: () => QueritProviderOptions);
    available(): boolean;
    fetch(request: {
        url: string;
    }, signal?: AbortSignal): Promise<WebFetchResult>;
    private client;
}
