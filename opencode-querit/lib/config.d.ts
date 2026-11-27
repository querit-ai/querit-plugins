/**
 * Plugin option resolution for opencode-querit. Raw options come from the
 * `options` object of the plugin's entry in `opencode.json(c)`; every value is
 * validated, normalized, and defaulted here so the tools only ever see a fully
 * resolved `QueritConfig`.
 *
 * API-key resolution happens per tool call in priority order: the
 * environment variable named by `apiKeyEnv` (default `QUERIT_API_KEY`), then
 * a literal `apiKey` option. The environment wins so a single exported key
 * overrides plugin config everywhere.
 * @module opencode-querit/config
 */
import { type QueritCountry, type QueritFetchFormat, type QueritLanguage, type QueritRankPreference, type QueritResourceTag, type QueritVertical } from "./client.js";
export declare const DEFAULT_API_KEY_ENV = "QUERIT_API_KEY";
export declare const BASE_URL_ENV = "QUERIT_BASE_URL";
/** Raw options accepted from the plugin's `options` object. */
export interface OpenCodeQueritOptions {
    /** Literal Querit API key; prefer `apiKeyEnv` so no secret enters opencode.json. */
    apiKey?: string;
    /** Environment variable holding the Querit API key (default: QUERIT_API_KEY). */
    apiKeyEnv?: string;
    /** Querit API base URL; `/v1/search` and `/v1/contents` are appended. */
    baseURL?: string;
    /** Per-request timeout in ms (default: 70000), retries and backoff waits included. */
    timeoutMs?: number;
    /** Result count per search, 1–100. Unset: Querit's server default decides. */
    count?: number;
    /** Relative (`d7`, `w2`, `m3`, `y1`) or `YYYY-MM-DDtoYYYY-MM-DD` date range. */
    timeRange?: string;
    /** Country filter; values from the Querit country list. */
    countries?: QueritCountry[];
    /** Language filter; values from the Querit language list. */
    languages?: QueritLanguage[];
    /** Whitelist hostnames (only these domains return results). */
    includeDomains?: string[];
    /** Blacklist hostnames (these domains never return results). */
    excludeDomains?: string[];
    /** Vertical search: `code` or `finance`. Unset: universal search. */
    vertical?: QueritVertical;
    /** Sub-tags of the `code` vertical to keep (`qa`, `github`). Requires `vertical: "code"`. */
    resourceTags?: QueritResourceTag[];
    /** Ranking preference, a boost on top of Querit's default ranking. Dropped for the `code` vertical. */
    rank?: QueritRankPreference;
    /** Request query-focused fragments (`highlights`) of each result. */
    highlights?: boolean;
    /** Request sentence-level content excerpts (`needContent`); excerpts are appended to each result's content. */
    includeContent?: boolean;
    /** Server-side limit on the body text of each result, in Unicode code points (1–1000000). Only read with `includeContent`. */
    contentMaxChars?: number;
    /** Request Markdown versions of each result's snippet and body (`needMarkdown`); Enterprise plans only. */
    needMarkdown?: boolean;
    /** Summary chunks per result, 1–3. Deprecated by Querit in favor of `highlights`; sent only when set. */
    chunksPerDoc?: number;
    /** Format requested from `/v1/contents` for fetch calls (default: markdown). */
    fetchFormat?: QueritFetchFormat;
    /** Per-page crawl timeout in seconds, 1–60 (default: 10). */
    fetchCrawlTimeout?: number;
    /** Cap applied to one fetched page's decoded body, in chars (default: 8000). */
    fetchMaxChars?: number;
    /** Cap on one tool's rendered output, in chars (default: 200000). */
    maxOutputChars?: number;
}
/** Fully resolved and validated configuration; every field is defaulted. */
export interface QueritConfig {
    apiKey?: string;
    apiKeyEnv: string;
    baseURL: string;
    timeoutMs: number;
    count?: number;
    timeRange?: string;
    countries: QueritCountry[];
    languages: QueritLanguage[];
    includeDomains: string[];
    excludeDomains: string[];
    vertical?: QueritVertical;
    resourceTags: QueritResourceTag[];
    rank?: QueritRankPreference;
    highlights: boolean;
    includeContent: boolean;
    contentMaxChars?: number;
    needMarkdown: boolean;
    chunksPerDoc?: number;
    fetchFormat: QueritFetchFormat;
    fetchCrawlTimeout: number;
    fetchMaxChars: number;
    maxOutputChars: number;
}
/**
 * Resolve raw plugin options (plus environment fallbacks) into a fully
 * defaulted `QueritConfig`. Throws a descriptive error on any invalid value
 * so a misconfigured `opencode.json` fails the plugin load loudly instead of
 * silently changing behavior.
 */
export declare function resolveConfig(options?: OpenCodeQueritOptions, env?: NodeJS.ProcessEnv): QueritConfig;
/**
 * Resolve the Querit API key for one operation: the environment variable
 * named by `apiKeyEnv` first (so `QUERIT_API_KEY` overrides everything for
 * testing), then the literal `apiKey` plugin option.
 */
export declare function resolveQueritApiKey(config: QueritConfig, env?: NodeJS.ProcessEnv): string | undefined;
