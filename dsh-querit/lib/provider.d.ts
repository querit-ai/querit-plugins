/**
 * Querit-backed `WebSearchProvider` and `WebFetchProvider` for the harness web
 * capability seam (`ctx.web`). Each operation snapshots the options resolved
 * for it, honors the caller's `AbortSignal`, maps failures to the seam's
 * `WebError` taxonomy, and never emits provider-generated answer text as
 * trusted `content` — only citeable sources.
 * @module dsh-querit/provider
 */
import type { LocalizedText } from "@deepseek-ai/dsh-package-manifest";
import type { WebFetchProvider, WebFetchResult, WebSearchProvider, WebSearchResult } from "@deepseek-ai/dsh-web";
import type { CredentialRef } from "@deepseek-ai/dsh-credentials";
import { type QueritClientOptions, type QueritContentsRequest, type QueritContentsResponse, type QueritRankPreference, type QueritResourceTag, type QueritSearchRequest, type QueritSearchResponse, type QueritVertical } from "./client.js";
/** Stable id both providers register under, mirroring the native `web-search-deepseek` row naming. */
export declare const QUERIT_PROVIDER_ID = "web-search-querit";
export declare const COUNTRY_VALUES: readonly ["argentina", "australia", "brazil", "canada", "colombia", "france", "germany", "india", "indonesia", "japan", "mexico", "nigeria", "philippines", "south korea", "spain", "united kingdom", "united states"];
export declare const LANGUAGE_VALUES: readonly ["english", "japanese", "korean", "german", "french", "spanish", "portuguese", "russian"];
/** What a completed operation reports to the observability hook. */
export interface QueritOperationEvent {
    operation: "search" | "fetch";
    /** Querit's request identifier; its support team traces a request with it. */
    searchId?: string;
    /** Server-side time as Querit reports it. */
    took?: string;
    /** Formatted `<currency> <amount>`; absent when Querit reported no cost. */
    cost?: string;
}
export interface QueritClientLike {
    search(request: QueritSearchRequest, signal?: AbortSignal): Promise<QueritSearchResponse>;
    contents(request: QueritContentsRequest, signal?: AbortSignal): Promise<QueritContentsResponse>;
}
export interface QueritProviderOptions {
    /** Literal Querit API key; when present it wins over `resolveApiKey`. */
    apiKey?: string;
    /** Resolve the current Querit API key for one operation. */
    resolveApiKey?: () => Promise<string | undefined>;
    /**
     * Whether a key is configured, without reading its value. Feeds the seam's
     * readiness answer; falls back to `resolveApiKey` when omitted.
     */
    apiKeyConfigured?: () => Promise<boolean>;
    /** Credential reference named by missing-credential diagnostics. */
    apiKeyEnv?: CredentialRef;
    /** Querit API base URL (`/v1/search` and `/v1/contents` are appended). */
    baseURL: string;
    /** Per-request timeout in ms. */
    timeoutMs: number;
    /** Result count used when the seam passes no `maxResults` bound; undefined leaves it to Querit. */
    count?: number;
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
    /** Request body text (`needContent`). */
    includeContent: boolean;
    /** Body-text budget per result, in Unicode code points. Only applies with `includeContent`. */
    contentMaxChars?: number;
    /** Request query-focused fragments of each page. */
    highlights: boolean;
    /** Ask for Markdown snippet and body. Enterprise plans only. */
    needMarkdown: boolean;
    /** Deprecated by Querit; sent only when a deployment still sets it. */
    chunksPerDoc?: number;
    /** A nudge on top of Querit's default ranking. Dropped for the code vertical, which rejects it. */
    rank?: QueritRankPreference;
    /** Vertical data source; a mismatched vertical loses results, so it stays unset by default. */
    vertical?: QueritVertical;
    /** Sub-tags narrowing the code vertical. */
    resourceTags: QueritResourceTag[];
    /** Format requested from `/v1/contents` for fetch calls. */
    fetchFormat: QueritContentsRequest["format"];
    /** Per-page crawl timeout in seconds, 1–60. */
    fetchCrawlTimeout: number;
    /** Cap applied to one fetched page's decoded body, in chars. */
    fetchMaxChars: number;
    /** Client factory used by tests; defaults to `QueritClient`. */
    clientFactory?: (options: QueritClientOptions) => QueritClientLike;
    /** Receives one event per completed operation. */
    observe?: (event: QueritOperationEvent) => void;
}
export declare function isTimeRange(value: unknown): value is string;
/**
 * Normalize a configured hostname list: lowercase, drop schemes/ports/paths,
 * and keep at most 100 unique entries. Invalid entries are dropped.
 */
export declare function normalizeDomains(values: readonly string[] | undefined): string[];
export declare class QueritSearchProvider implements WebSearchProvider {
    private readonly resolveOptions;
    readonly id = "web-search-querit";
    readonly title = "Querit";
    readonly description: LocalizedText;
    /**
     * @param resolveOptions - options for the NEXT operation, snapshotted once
     * at each operation's entry so one search never mixes two settings sections.
     */
    constructor(resolveOptions: () => QueritProviderOptions);
    available(): boolean;
    /** Whether a search now would have a key to send; configuration only, no network. */
    ready(): Promise<boolean>;
    search(request: {
        query: string;
        maxResults?: number;
        llmProvider?: string;
    }, signal?: AbortSignal): Promise<WebSearchResult>;
}
export declare class QueritFetchProvider implements WebFetchProvider {
    private readonly resolveOptions;
    readonly id = "web-search-querit";
    readonly title = "Querit";
    readonly description: LocalizedText;
    constructor(resolveOptions: () => QueritProviderOptions);
    available(): boolean;
    /** Whether a fetch now would have a key to send; configuration only, no network. */
    ready(): Promise<boolean>;
    fetch(request: {
        url: string;
    }, signal?: AbortSignal): Promise<WebFetchResult>;
}
