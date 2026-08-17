/**
 * opencode-querit — Querit-backed `web_search` and `web_fetch` custom tools
 * for OpenCode. Both tools call the public Querit API
 * (`POST https://api.querit.ai/v1/search` and `/v1/contents`) with a Bearer
 * key resolved per call from the plugin options or `QUERIT_API_KEY`.
 *
 * Register via `opencode.json`:
 * ```json
 * { "plugin": ["opencode-querit", { "count": 8, "timeRange": "m3" }] }
 * ```
 * @module opencode-querit
 */
import { type Plugin } from "@opencode-ai/plugin";
import { type QueritClientOptions, type QueritContentsRequest, type QueritContentsResponse, type QueritSearchRequest, type QueritSearchResponse } from "./client.js";
import { type OpenCodeQueritOptions, type QueritConfig } from "./config.js";
export interface QueritClientLike {
    search(request: QueritSearchRequest, signal?: AbortSignal): Promise<QueritSearchResponse>;
    contents(request: QueritContentsRequest, signal?: AbortSignal): Promise<QueritContentsResponse>;
}
export interface QueritPluginOptions extends OpenCodeQueritOptions {
    /** Client factory used by tests; defaults to `QueritClient`. */
    clientFactory?: (options: QueritClientOptions) => QueritClientLike;
}
export declare const QueritPlugin: Plugin;
export default QueritPlugin;
/** Build the /v1/search request body from config defaults plus per-call overrides. */
export declare function buildSearchRequest(config: QueritConfig, query: string, count?: number): QueritSearchRequest;
/** Validate and normalize requested URLs: HTTP(S) only, no embedded credentials, at most 10 unique. */
export declare function normalizeRequestedUrls(singleUrl?: string, multipleUrls?: string[]): string[];
export declare function errorMessage(error: unknown): string;
