/**
 * Register Querit-backed search and fetch providers in `ctx.web`.
 * Both providers call the public Querit API (`POST /v1/search`,
 * `POST /v1/contents`) with a Bearer key resolved per operation through the
 * optional `ctx.credentials` seam, falling back to the launching environment.
 * The model-facing `web_search` / `web_fetch` tools keep routing through the
 * seam; this package never registers a tool.
 * @module dsh-querit
 */
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { type CredentialRef } from "@deepseek-ai/dsh-credentials";
import { type QueritProviderOptions } from "./provider.js";
export { COUNTRY_VALUES, LANGUAGE_VALUES, QUERIT_PROVIDER_ID, TIME_RANGE_PATTERN, QueritFetchProvider, QueritSearchProvider, } from "./provider.js";
export type { QueritClientLike, QueritProviderOptions } from "./provider.js";
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "web-search-querit";
/**
 * The web seam both providers register into, plus the registries the optional
 * model-facing `web_fetch` tool needs (reused from `@deepseek-ai/dsh-tool-web`).
 */
export declare const inject: string[];
export declare const DEFAULT_API_KEY_ENV = "QUERIT_API_KEY";
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
    /** Literal Querit API key; prefer `apiKeyEnv` so no secret enters configuration files. */
    apiKey?: string;
    /** Credential reference resolved per operation; defaults to `QUERIT_API_KEY`. */
    apiKeyEnv?: string;
    /** Querit API base URL; `/v1/search` and `/v1/contents` are appended. */
    baseURL?: string;
    /** Per-request timeout in ms. Defaults to 70000. */
    timeoutMs?: number;
    /** Result count used when the seam passes no `maxResults` bound (1–20). */
    count?: number;
    /** Relative (`d7`, `w2`, `m3`, `y1`) or `YYYY-MM-DDtoYYYY-MM-DD` date range. */
    timeRange?: string;
    /** Country bias; values from the Querit country list. */
    countries?: string[];
    /** Language filter; values from the Querit language list. */
    languages?: string[];
    /** Whitelist hostnames (only these domains return results). */
    includeDomains?: string[];
    /** Blacklist hostnames (these domains never return results). */
    excludeDomains?: string[];
    /** Request sentence-level content excerpts (`needContent`). */
    includeContent?: boolean;
    /** Content chunks per result (1–3). */
    chunksPerDoc?: number;
    /** Format requested from `/v1/contents` for fetch calls. */
    fetchFormat?: "markdown" | "text" | "html";
    /** Per-page crawl timeout in seconds (1–60). */
    fetchCrawlTimeout?: number;
    /** Cap applied to one fetched page's decoded body, in chars. */
    fetchMaxChars?: number;
    /**
     * Register the model-facing `web_fetch` tool (via `dsh-tool-web`'s
     * `applyWebFetchTool`). Defaults to true; set false when another row
     * already registers `web_fetch` in the same scope.
     */
    fetch?: boolean;
    /** Cooperative tool-call timeout budget (ms) for `web_fetch`. Defaults to 30000. */
    fetchTimeoutMs?: number;
    /** Cap on one `web_fetch` rendered output, in chars. Defaults to 200000. */
    fetchMaxOutputChars?: number;
}
export declare const Config: z<Config>;
/** Settings namespace carrying this provider's endpoint, key reference, and search defaults. */
export declare const WEB_SEARCH_QUERIT_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/**
 * Project one resolved section into the options both providers serve their
 * next operation with. Environment fallbacks stay here rather than in the
 * providers: every value they read is already fully defaulted.
 */
export declare function resolveOptions(ctx: Context, config: Config): QueritProviderOptions;
/** Register both Querit providers with `ctx.web`, the `web_fetch` tool, and the first-load key check. */
export declare function apply(ctx: Context, config: Config): Promise<void>;
/**
 * Resolve the Querit API key for one operation in priority order: literal row
 * `apiKey`, then the credentials service (which itself reads the inherited
 * environment before the managed document), then the launching environment.
 */
export declare function resolveQueritApiKey(ctx: Context, apiKeyEnv: CredentialRef, literalApiKey: string | undefined): Promise<string | undefined>;
/**
 * Reject a resolved settings section this plugin could not act on, for
 * constraints the schema cannot express. Throwing here keeps the settings UI
 * from committing an invalid section while the previous good value stays live.
 */
export declare function validateSection(value: Config): void;
