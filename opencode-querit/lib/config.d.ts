/**
 * Plugin option resolution for opencode-querit. Raw options come from the
 * `["opencode-querit", { ... }]` tuple in `opencode.json` (or a local plugin
 * file); every value is validated, normalized, and defaulted here so the
 * tools only ever see a fully resolved `QueritConfig`.
 *
 * API-key resolution happens per tool call in priority order: the
 * environment variable named by `apiKeyEnv` (default `QUERIT_API_KEY`), then
 * a literal `apiKey` option. The environment wins so a single exported key
 * overrides plugin config everywhere.
 * @module opencode-querit/config
 */
export declare const COUNTRY_VALUES: readonly ["argentina", "australia", "brazil", "canada", "colombia", "france", "germany", "india", "indonesia", "japan", "mexico", "nigeria", "philippines", "south korea", "spain", "united kingdom", "united states"];
export declare const LANGUAGE_VALUES: readonly ["english", "japanese", "korean", "german", "french", "spanish", "portuguese"];
/** `dN`/`wN`/`mN`/`yN` (N ≥ 1) or an inclusive `YYYY-MM-DDtoYYYY-MM-DD` range. */
export declare const TIME_RANGE_PATTERN: RegExp;
export declare const DEFAULT_API_KEY_ENV = "QUERIT_API_KEY";
export declare const BASE_URL_ENV = "QUERIT_BASE_URL";
export declare const DEFAULT_COUNT = 5;
export declare const DEFAULT_TIMEOUT_MS = 70000;
export declare const DEFAULT_CHUNKS_PER_DOC = 1;
export declare const DEFAULT_FETCH_FORMAT = "markdown";
export declare const DEFAULT_FETCH_CRAWL_TIMEOUT = 10;
export declare const DEFAULT_FETCH_MAX_CHARS = 8000;
export declare const DEFAULT_MAX_OUTPUT_CHARS = 200000;
export type FetchFormat = "text" | "markdown" | "html";
/** Raw options accepted from the `opencode.json` plugin tuple. */
export interface OpenCodeQueritOptions {
    /** Literal Querit API key; prefer `apiKeyEnv` so no secret enters opencode.json. */
    apiKey?: string;
    /** Environment variable holding the Querit API key (default: QUERIT_API_KEY). */
    apiKeyEnv?: string;
    /** Querit API base URL; `/v1/search` and `/v1/contents` are appended. */
    baseURL?: string;
    /** Per-request timeout in ms (default: 70000). */
    timeoutMs?: number;
    /** Default result count per search, 1–20 (default: 5). */
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
    /** Content chunks per result, 1–3 (default: 1). */
    chunksPerDoc?: number;
    /** Format requested from `/v1/contents` for fetch calls (default: markdown). */
    fetchFormat?: FetchFormat;
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
    count: number;
    timeRange?: string;
    countries: string[];
    languages: string[];
    includeDomains: string[];
    excludeDomains: string[];
    includeContent: boolean;
    chunksPerDoc: number;
    fetchFormat: FetchFormat;
    fetchCrawlTimeout: number;
    fetchMaxChars: number;
    maxOutputChars: number;
}
export declare function isTimeRange(value: unknown): value is string;
/**
 * Normalize a configured hostname list: lowercase, drop schemes/ports/paths,
 * and keep at most 100 unique entries. Invalid entries are dropped.
 */
export declare function normalizeDomains(values: readonly string[] | undefined): string[];
export declare function normalizeHostname(value: string): string | undefined;
/**
 * Resolve raw plugin options (plus environment fallbacks) into a fully
 * defaulted `QueritConfig`. Throws a descriptive error on any invalid value
 * so a misconfigured `opencode.json` fails the tool call loudly instead of
 * silently changing behavior.
 */
export declare function resolveConfig(options?: OpenCodeQueritOptions, env?: NodeJS.ProcessEnv): QueritConfig;
/**
 * Resolve the Querit API key for one operation: the environment variable
 * named by `apiKeyEnv` first (so `QUERIT_API_KEY` overrides everything for
 * testing), then the literal `apiKey` plugin option.
 */
export declare function resolveQueritApiKey(config: QueritConfig, env?: NodeJS.ProcessEnv): string | undefined;
