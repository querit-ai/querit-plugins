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
import {
  COUNTRY_VALUES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  FETCH_FORMAT_VALUES,
  LANGUAGE_VALUES,
  QUERIT_API_BASE_URL,
  QUERIT_CONTENT_MAX_CHARS_LIMIT,
  QUERIT_COUNT_LIMIT,
  QUERIT_CRAWL_TIMEOUT_MAX_SECONDS,
  QUERIT_CRAWL_TIMEOUT_MIN_SECONDS,
  RANK_VALUES,
  RESOURCE_TAG_VALUES,
  VERTICAL_VALUES,
  type QueritCountry,
  type QueritFetchFormat,
  type QueritLanguage,
  type QueritRankPreference,
  type QueritResourceTag,
  type QueritVertical,
} from "./client.js";

/** `dN`/`wN`/`mN`/`yN` (N ≥ 1) or a `YYYY-MM-DDtoYYYY-MM-DD` range: the letter comes first and a range has no spaces. */
const TIME_RANGE_PATTERN = /^(?:[dwmy][1-9][0-9]*|\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2})$/u;

export const DEFAULT_API_KEY_ENV = "QUERIT_API_KEY";
export const BASE_URL_ENV = "QUERIT_BASE_URL";
const DEFAULT_FETCH_FORMAT: QueritFetchFormat = "markdown";
const DEFAULT_FETCH_CRAWL_TIMEOUT = 10;
const DEFAULT_FETCH_MAX_CHARS = 8_000;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;

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

function isTimeRange(value: unknown): value is string {
  return typeof value === "string" && TIME_RANGE_PATTERN.test(value.trim());
}

/**
 * Normalize a configured hostname list: lowercase, drop schemes/ports/paths,
 * and keep at most 100 unique entries. Invalid entries are dropped.
 */
function normalizeDomains(values: readonly string[] | undefined): string[] {
  const domains = new Set<string>();
  for (const entry of values ?? []) {
    const host = normalizeHostname(entry);
    if (host) domains.add(host);
    if (domains.size >= 100) break;
  }
  return [...domains];
}

function normalizeHostname(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const host = url.hostname.toLowerCase();
  if (!host || host.length > 253 || !host.includes(".")) return undefined;
  return host;
}

/**
 * Resolve raw plugin options (plus environment fallbacks) into a fully
 * defaulted `QueritConfig`. Throws a descriptive error on any invalid value
 * so a misconfigured `opencode.json` fails the plugin load loudly instead of
 * silently changing behavior.
 */
export function resolveConfig(
  options: OpenCodeQueritOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): QueritConfig {
  const apiKeyEnv = (options.apiKeyEnv ?? DEFAULT_API_KEY_ENV).trim();
  if (!apiKeyEnv) throw new Error("apiKeyEnv must be a non-empty environment variable name.");

  const literalApiKey = options.apiKey !== undefined && options.apiKey.trim().length > 0
    ? options.apiKey.trim()
    : undefined;

  const baseURL = (options.baseURL?.trim() || env[BASE_URL_ENV]?.trim() || QUERIT_API_BASE_URL).replace(/\/+$/, "");
  if (!URL.canParse(baseURL) || !/^https?:$/u.test(new URL(baseURL).protocol)) {
    throw new Error(`baseURL must be a parseable HTTP(S) URL: ${baseURL}`);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
    throw new Error("timeoutMs must be an integer of at least 1000 ms.");
  }

  // count, contentMaxChars and chunksPerDoc stay unset unless configured: Querit's server
  // defaults apply, and chunksPerDoc is deprecated, so it is never sent on the plugin's own.
  const count = options.count;
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > QUERIT_COUNT_LIMIT)) {
    throw new Error(`count must be an integer between 1 and ${QUERIT_COUNT_LIMIT}.`);
  }

  const contentMaxChars = options.contentMaxChars;
  if (
    contentMaxChars !== undefined
    && (!Number.isInteger(contentMaxChars) || contentMaxChars < 1 || contentMaxChars > QUERIT_CONTENT_MAX_CHARS_LIMIT)
  ) {
    throw new Error(`contentMaxChars must be an integer between 1 and ${QUERIT_CONTENT_MAX_CHARS_LIMIT}.`);
  }

  const chunksPerDoc = options.chunksPerDoc;
  if (chunksPerDoc !== undefined && (!Number.isInteger(chunksPerDoc) || chunksPerDoc < 1 || chunksPerDoc > 3)) {
    throw new Error("chunksPerDoc must be an integer between 1 and 3.");
  }

  const fetchFormat = enumValue(options.fetchFormat, FETCH_FORMAT_VALUES, "fetchFormat") ?? DEFAULT_FETCH_FORMAT;
  const fetchCrawlTimeout = options.fetchCrawlTimeout ?? DEFAULT_FETCH_CRAWL_TIMEOUT;
  if (
    !Number.isInteger(fetchCrawlTimeout)
    || fetchCrawlTimeout < QUERIT_CRAWL_TIMEOUT_MIN_SECONDS
    || fetchCrawlTimeout > QUERIT_CRAWL_TIMEOUT_MAX_SECONDS
  ) {
    throw new Error(
      `fetchCrawlTimeout must be an integer between ${QUERIT_CRAWL_TIMEOUT_MIN_SECONDS} and ${QUERIT_CRAWL_TIMEOUT_MAX_SECONDS} seconds.`,
    );
  }

  const fetchMaxChars = options.fetchMaxChars ?? DEFAULT_FETCH_MAX_CHARS;
  if (!Number.isInteger(fetchMaxChars) || fetchMaxChars < 256) {
    throw new Error("fetchMaxChars must be an integer of at least 256 chars.");
  }

  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  if (!Number.isInteger(maxOutputChars) || maxOutputChars < 256) {
    throw new Error("maxOutputChars must be an integer of at least 256 chars.");
  }

  const timeRange = options.timeRange?.trim();
  if (timeRange !== undefined && timeRange.length > 0 && !isTimeRange(timeRange)) {
    throw new Error("timeRange must be a relative range (d7, w2, m3, y1, ...) or YYYY-MM-DDtoYYYY-MM-DD.");
  }

  const vertical = enumValue(options.vertical, VERTICAL_VALUES, "vertical");
  const rank = enumValue(options.rank, RANK_VALUES, "rank");
  const resourceTags = normalizeEnumList(options.resourceTags, RESOURCE_TAG_VALUES, "resourceTags");
  if (resourceTags.length > 0 && vertical !== "code") {
    throw new Error('resourceTags only applies to the "code" vertical; set vertical to "code" or remove resourceTags.');
  }

  return {
    ...(literalApiKey === undefined ? {} : { apiKey: literalApiKey }),
    apiKeyEnv,
    baseURL,
    timeoutMs,
    ...(count === undefined ? {} : { count }),
    ...(timeRange === undefined || timeRange.length === 0 ? {} : { timeRange }),
    countries: normalizeEnumList(options.countries, COUNTRY_VALUES, "countries"),
    languages: normalizeEnumList(options.languages, LANGUAGE_VALUES, "languages"),
    includeDomains: normalizeDomains(options.includeDomains),
    excludeDomains: normalizeDomains(options.excludeDomains),
    ...(vertical === undefined ? {} : { vertical }),
    resourceTags,
    ...(rank === undefined ? {} : { rank }),
    highlights: options.highlights ?? false,
    includeContent: options.includeContent ?? false,
    ...(contentMaxChars === undefined ? {} : { contentMaxChars }),
    needMarkdown: options.needMarkdown ?? false,
    ...(chunksPerDoc === undefined ? {} : { chunksPerDoc }),
    fetchFormat,
    fetchCrawlTimeout,
    fetchMaxChars,
    maxOutputChars,
  };
}

/**
 * Resolve the Querit API key for one operation: the environment variable
 * named by `apiKeyEnv` first (so `QUERIT_API_KEY` overrides everything for
 * testing), then the literal `apiKey` plugin option.
 */
export function resolveQueritApiKey(
  config: QueritConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const ambient = env[config.apiKeyEnv]?.trim();
  if (ambient !== undefined && ambient.length > 0) return ambient;
  if (config.apiKey !== undefined && config.apiKey.length > 0) return config.apiKey;
  return undefined;
}

/** Reads an optional enum option; returns its normalized value or undefined when unset. */
function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined) return undefined;
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!new Set<string>(allowed).has(normalized)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")} (got: ${String(value)}).`);
  }
  return normalized as T;
}

function normalizeEnumList<T extends string>(
  values: readonly string[] | undefined,
  allowed: readonly T[],
  field: string,
): T[] {
  if (values === undefined) return [];
  const allowedSet = new Set<string>(allowed);
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()))];
  const unknown = normalized.filter((value) => !allowedSet.has(value));
  if (unknown.length > 0) {
    throw new Error(`${field} contains unsupported values: ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}.`);
  }
  return normalized as T[];
}
