/**
 * opencode-querit — Querit web search for OpenCode v2. The plugin registers
 * Querit as a websearch provider (powering OpenCode's built-in `websearch`
 * tool) plus a `web_fetch` custom tool backed by Querit's /v1/contents API.
 * Both call the public Querit API (`POST https://api.querit.ai/v1/search` and
 * `/v1/contents`) with a Bearer key resolved per call from the plugin options
 * or `QUERIT_API_KEY`.
 *
 * Register via `opencode.json`:
 * ```json
 * { "plugins": [{ "package": "opencode-querit", "options": { "count": 8 } }] }
 * ```
 * @module opencode-querit
 */
import type { Plugin, WebSearch } from "@opencode/plugin";
import type { Metadata, Result } from "@opencode/plugin/promise/tool";
import { z } from "zod";
import { type QueritClientOptions, type QueritContentsRequest, type QueritContentsResponse, type QueritSearchRequest, type QueritSearchResponse } from "./client.js";
import { type OpenCodeQueritOptions, type QueritConfig } from "./config.js";
/** Provider id under which Querit is registered with the websearch domain. */
export declare const QUERIT_PROVIDER_ID = "querit";
export interface QueritClientLike {
    search(request: QueritSearchRequest, signal?: AbortSignal): Promise<QueritSearchResponse>;
    contents(request: QueritContentsRequest, signal?: AbortSignal): Promise<QueritContentsResponse>;
}
export interface QueritPluginOptions extends OpenCodeQueritOptions {
    /**
     * Make Querit the default websearch provider at startup. Defaults to false:
     * the built-in websearch tool then offers Querit in its first-use provider
     * form, and the user can pin it via config `websearch.provider` without the
     * plugin overriding that choice on every launch.
     */
    setDefault?: boolean;
    /** Client factory used by tests; defaults to `QueritClient`. */
    clientFactory?: (options: QueritClientOptions) => QueritClientLike;
}
/** Minimal structural stand-in for the host's tool execution context. */
export interface QueritToolContext {
    readonly progress: (update: Metadata) => Promise<void>;
}
declare const fetchInput: z.ZodObject<{
    url: z.ZodOptional<z.ZodString>;
    urls: z.ZodOptional<z.ZodArray<z.ZodString>>;
    format: z.ZodOptional<z.ZodEnum<{
        text: "text";
        markdown: "markdown";
        html: "html";
    }>>;
    crawl_timeout: z.ZodOptional<z.ZodNumber>;
    include_metadata: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
type FetchInput = z.infer<typeof fetchInput>;
export interface QueritWebSearchProvider {
    readonly id: string;
    readonly name: string;
    readonly execute: (input: {
        query: string;
    }, context: {
        readonly signal: AbortSignal;
    }) => Promise<readonly WebSearch.Result[]>;
}
export interface QueritFetchTool {
    readonly name: string;
    readonly description: string;
    readonly input: typeof fetchInput;
    readonly execute: (input: FetchInput, context: QueritToolContext) => Promise<Result>;
}
/**
 * Build the Querit websearch provider registered with OpenCode's websearch
 * domain. Every execution resolves the config and API key from the current
 * environment so a restarted host (or a changed env) is picked up per query.
 */
export declare function createQueritWebSearchProvider(options?: QueritPluginOptions): QueritWebSearchProvider;
/** Build the `web_fetch` custom tool backed by Querit's /v1/contents API. */
export declare function createQueritFetchTool(options?: QueritPluginOptions): QueritFetchTool;
export declare const QueritPlugin: Plugin.Plugin;
export default QueritPlugin;
/** Build the /v1/search request body from config defaults. */
export declare function buildSearchRequest(config: QueritConfig, query: string, count?: number): QueritSearchRequest;
/**
 * Map a Querit search response to OpenCode's WebSearch.Result shape. Every
 * remote string is sanitized and capped; the total content budget is
 * `maxOutputChars` across all results.
 */
export declare function toWebSearchResults(response: QueritSearchResponse, config: QueritConfig): WebSearch.Result[];
/** Validate and normalize requested URLs: HTTP(S) only, no embedded credentials, at most 10 unique. */
export declare function normalizeRequestedUrls(singleUrl?: string, multipleUrls?: string[]): string[];
