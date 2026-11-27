/**
 * Register Querit-backed search and fetch providers in `ctx.web`.
 * Both providers call the public Querit API (`POST /v1/search`,
 * `POST /v1/contents`) with a Bearer key resolved per operation from a
 * literal row `apiKey`, then the credentials service (or, only where none
 * runs, the launching environment).
 * The agent preset registers model-facing `web_search`; this package does not.
 * Both model-facing web tools route through the seam, so once it selects Querit
 * neither needs a registration here; `fetch: true` opts into registering
 * `web_fetch` via the official `applyWebFetchTool` helper for compositions
 * where no `tool-web` row provides it.
 * @module dsh-querit
 */
import type { Context, Volatile } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { type CredentialRef } from "@deepseek-ai/dsh-credentials";
import type { QueritContentsRequest } from "./client.js";
import { type QueritProviderOptions } from "./provider.js";
export { QueritFetchProvider, QueritSearchProvider } from "./provider.js";
export type { QueritClientLike, QueritOperationEvent, QueritProviderOptions } from "./provider.js";
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "web-search-querit";
/** Only the web seam is required; the optional `web_fetch` tool injects its own registries. */
export declare const inject: string[];
export declare const DEFAULT_API_KEY_ENV = "QUERIT_API_KEY";
/**
 * Plugin config. Every field is a `Volatile` handle: the host re-resolves the
 * section when the entry is edited, so each operation reads the current value
 * through `.get()` instead of caching what `apply` saw.
 */
export interface Config {
    /** Literal Querit API key; prefer `apiKeyEnv` so no secret enters configuration files. */
    apiKey: Volatile<string | undefined>;
    /** Credential reference resolved per operation; defaults to `QUERIT_API_KEY`. */
    apiKeyEnv: Volatile<string>;
    /** Querit API base URL; `/v1/search` and `/v1/contents` are appended. */
    baseURL: Volatile<string | undefined>;
    /** Per-request timeout in ms, retries included. Defaults to 70000. */
    timeoutMs: Volatile<number>;
    /** Result count used when the seam passes no `maxResults` bound (1–100). Unset leaves it to Querit. */
    count: Volatile<number | undefined>;
    /** Relative (`d7`, `w2`, `m3`, `y1`) or `YYYY-MM-DDtoYYYY-MM-DD` date range. */
    timeRange: Volatile<string | undefined>;
    /** Country bias; values from the Querit country list. */
    countries: Volatile<string[] | undefined>;
    /** Language filter; values from the Querit language list. */
    languages: Volatile<string[] | undefined>;
    /** Whitelist hostnames (only these domains return results). */
    includeDomains: Volatile<string[] | undefined>;
    /** Blacklist hostnames (these domains never return results). */
    excludeDomains: Volatile<string[] | undefined>;
    /** Request body text (`needContent`). */
    includeContent: Volatile<boolean>;
    /** Body-text budget per result, in Unicode code points (1–1000000). Only with `includeContent`. */
    contentMaxChars: Volatile<number | undefined>;
    /** Request query-focused fragments of each page. */
    highlights: Volatile<boolean>;
    /** Ask for Markdown snippet and body. Enterprise plans only. */
    needMarkdown: Volatile<boolean>;
    /** Deprecated by Querit; kept so existing rows keep working. Prefer `highlights`. */
    chunksPerDoc: Volatile<number | undefined>;
    /** Ranking nudge: `relevance` or `freshness`. Dropped for `vertical: code`, which rejects it. */
    rank: Volatile<string | undefined>;
    /** Vertical data source: `code` or `finance`. Unset for universal search. */
    vertical: Volatile<string | undefined>;
    /** Sub-tags narrowing the code vertical: `qa`, `github`. */
    resourceTags: Volatile<string[] | undefined>;
    /** Format requested from `/v1/contents` for fetch calls. */
    fetchFormat: Volatile<QueritContentsRequest["format"]>;
    /** Per-page crawl timeout in seconds (1–60). */
    fetchCrawlTimeout: Volatile<number>;
    /** Cap applied to one fetched page's decoded body, in chars. */
    fetchMaxChars: Volatile<number>;
    /**
     * Register the model-facing `web_fetch` tool (via `dsh-tool-web`'s
     * `applyWebFetchTool`). Defaults to false: the base and agent-preset
     * `tool-web` rows register `web_fetch` themselves (both routing through
     * `ctx.web`, hence Querit); enable only for compositions where no other row
     * provides the tool. Read when the entry starts, so a change applies on restart.
     */
    fetch: Volatile<boolean>;
    /** Cooperative tool-call timeout budget (ms) for `web_fetch`. Defaults to 30000. Read at start. */
    fetchTimeoutMs: Volatile<number>;
    /** Cap on one `web_fetch` rendered output, in chars. Defaults to 200000. Read at start. */
    fetchMaxOutputChars: Volatile<number>;
}
export declare const Config: z<Config>;
/** The config with every handle read once: one consistent view for one operation. */
export type ResolvedQueritConfig = {
    [K in keyof Config]: ReturnType<Config[K]["get"]>;
};
/**
 * Project one read of the config into the options both providers serve their
 * next operation with. Every value is fully defaulted, so the providers never
 * branch on absence.
 */
export declare function resolveOptions(ctx: Context, config: ResolvedQueritConfig): QueritProviderOptions;
/** Register both Querit providers with `ctx.web`, the optional `web_fetch` tool, and the first-load key check. */
export declare function apply(ctx: Context, config: Config): void;
/**
 * Resolve the Querit API key for one operation. An installed credentials
 * service is authoritative, including absence, as it is for the host's own
 * providers; only deployments without that service read the launching
 * environment.
 */
export declare function resolveQueritApiKey(ctx: Context, apiKeyEnv: CredentialRef): Promise<string | undefined>;
/** Whether a key is configured, without resolving the stored value. */
export declare function queritApiKeyConfigured(ctx: Context, apiKeyEnv: CredentialRef): Promise<boolean>;
