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
// Type-only: the Context merges for the services this plugin reads.
import type {} from "@deepseek-ai/dsh-credentials";
import { credentialRef, type CredentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import type {} from "@deepseek-ai/dsh-settings";
import type {} from "@deepseek-ai/dsh-system-prompt";
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-web";
import {
  DEFAULT_FETCH_MAX_OUTPUT_CHARS,
  DEFAULT_WEB_TOOL_TIMEOUT_MS,
  applyWebFetchTool,
} from "@deepseek-ai/dsh-tool-web";
import type { QueritContentsRequest } from "./client.js";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  QUERIT_API_BASE_URL,
  QUERIT_CONTENT_MAX_CHARS_LIMIT,
  QUERIT_COUNT_LIMIT,
  RANK_VALUES,
  RESOURCE_TAG_VALUES,
  VERTICAL_VALUES,
} from "./client.js";
import {
  COUNTRY_VALUES,
  LANGUAGE_VALUES,
  QueritFetchProvider,
  QueritSearchProvider,
  isTimeRange,
  normalizeDomains,
  type QueritProviderOptions,
} from "./provider.js";

// The providers leave through the package entry for scripts that drive them directly.
export { QueritFetchProvider, QueritSearchProvider } from "./provider.js";
export type { QueritClientLike, QueritOperationEvent, QueritProviderOptions } from "./provider.js";

/** Cordis plugin name used by loader diagnostics. */
export const name = "web-search-querit";
/** Only the web seam is required; the optional `web_fetch` tool injects its own registries. */
export const inject = ["web"];

export const DEFAULT_API_KEY_ENV = "QUERIT_API_KEY";
const BASE_URL_ENV = "QUERIT_BASE_URL";

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

export const Config = z.object({
  apiKey: z.string().role("secret").volatile(),
  apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV).volatile(),
  baseURL: z.string().volatile(),
  timeoutMs: z.number().step(1).min(1_000).default(DEFAULT_REQUEST_TIMEOUT_MS).volatile(),
  count: z.number().step(1).min(1).max(QUERIT_COUNT_LIMIT).volatile(),
  timeRange: z.string().volatile(),
  countries: z.array(z.string()).volatile(),
  languages: z.array(z.string()).volatile(),
  includeDomains: z.array(z.string()).volatile(),
  excludeDomains: z.array(z.string()).volatile(),
  includeContent: z.boolean().default(false).volatile(),
  contentMaxChars: z.number().step(1).min(1).max(QUERIT_CONTENT_MAX_CHARS_LIMIT).volatile(),
  highlights: z.boolean().default(false).volatile(),
  needMarkdown: z.boolean().default(false).volatile(),
  chunksPerDoc: z.number().step(1).min(1).max(3).volatile(),
  rank: z.string().volatile(),
  vertical: z.string().volatile(),
  resourceTags: z.array(z.string()).volatile(),
  fetchFormat: z.union([z.const("markdown"), z.const("text"), z.const("html")]).default("markdown").volatile(),
  fetchCrawlTimeout: z.number().step(1).min(1).max(60).default(10).volatile(),
  fetchMaxChars: z.number().step(1).min(256).default(8_000).volatile(),
  fetch: z.boolean().default(false).volatile(),
  fetchTimeoutMs: z.number().step(1).min(1_000).default(DEFAULT_WEB_TOOL_TIMEOUT_MS).volatile(),
  fetchMaxOutputChars: z.number().step(1).min(256).default(DEFAULT_FETCH_MAX_OUTPUT_CHARS).volatile(),
}) as z<Config>;

/** The config with every handle read once: one consistent view for one operation. */
export type ResolvedQueritConfig = { [K in keyof Config]: ReturnType<Config[K]["get"]> };

/**
 * Project one read of the config into the options both providers serve their
 * next operation with. Every value is fully defaulted, so the providers never
 * branch on absence.
 */
export function resolveOptions(ctx: Context, config: ResolvedQueritConfig): QueritProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
  const literalApiKey = config.apiKey !== undefined && config.apiKey.trim().length > 0
    ? config.apiKey.trim()
    : undefined;
  const timeRange = normalizeTimeRange(config.timeRange);

  return {
    ...(literalApiKey === undefined ? {} : { apiKey: literalApiKey }),
    resolveApiKey: () => resolveQueritApiKey(ctx, apiKeyEnv),
    apiKeyConfigured: () => queritApiKeyConfigured(ctx, apiKeyEnv),
    apiKeyEnv,
    baseURL: (config.baseURL ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value ?? QUERIT_API_BASE_URL).replace(/\/+$/, ""),
    timeoutMs: config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    ...(config.count === undefined ? {} : { count: config.count }),
    ...(timeRange === undefined ? {} : { timeRange }),
    countries: normalizeEnumList(config.countries, COUNTRY_VALUES),
    languages: normalizeEnumList(config.languages, LANGUAGE_VALUES),
    includeDomains: normalizeDomains(config.includeDomains),
    excludeDomains: normalizeDomains(config.excludeDomains),
    includeContent: config.includeContent ?? false,
    ...(config.contentMaxChars === undefined ? {} : { contentMaxChars: config.contentMaxChars }),
    highlights: config.highlights ?? false,
    needMarkdown: config.needMarkdown ?? false,
    ...(config.chunksPerDoc === undefined ? {} : { chunksPerDoc: config.chunksPerDoc }),
    rank: normalizeEnum(config.rank, RANK_VALUES),
    vertical: normalizeEnum(config.vertical, VERTICAL_VALUES),
    resourceTags: normalizeEnumList(config.resourceTags, RESOURCE_TAG_VALUES),
    fetchFormat: config.fetchFormat ?? "markdown",
    fetchCrawlTimeout: config.fetchCrawlTimeout ?? 10,
    fetchMaxChars: config.fetchMaxChars ?? 8_000,
    observe: (event) => {
      // Querit asks for search_id, took, and cost on every operation: support
      // traces a request by the id alone, and an absent cost is never "free".
      const fields = [
        event.searchId === undefined ? "" : `search_id=${event.searchId}`,
        event.took === undefined ? "" : `took=${event.took}`,
        event.cost === undefined ? "cost=n/a" : `cost=${event.cost}`,
      ].filter(Boolean);
      ctx.logger.info(`web-search-querit: ${event.operation} ${fields.join(" ")}`);
    },
  };
}

/** Register both Querit providers with `ctx.web`, the optional `web_fetch` tool, and the first-load key check. */
export function apply(ctx: Context, config: Config): void {
  const current = (): ResolvedQueritConfig => ({
    apiKey: config.apiKey.get(),
    apiKeyEnv: config.apiKeyEnv.get(),
    baseURL: config.baseURL.get(),
    timeoutMs: config.timeoutMs.get(),
    count: config.count.get(),
    timeRange: config.timeRange.get(),
    countries: config.countries.get(),
    languages: config.languages.get(),
    includeDomains: config.includeDomains.get(),
    excludeDomains: config.excludeDomains.get(),
    includeContent: config.includeContent.get(),
    contentMaxChars: config.contentMaxChars.get(),
    highlights: config.highlights.get(),
    needMarkdown: config.needMarkdown.get(),
    chunksPerDoc: config.chunksPerDoc.get(),
    rank: config.rank.get(),
    vertical: config.vertical.get(),
    resourceTags: config.resourceTags.get(),
    fetchFormat: config.fetchFormat.get(),
    fetchCrawlTimeout: config.fetchCrawlTimeout.get(),
    fetchMaxChars: config.fetchMaxChars.get(),
    fetch: config.fetch.get(),
    fetchTimeoutMs: config.fetchTimeoutMs.get(),
    fetchMaxOutputChars: config.fetchMaxOutputChars.get(),
  });
  const options = () => resolveOptions(ctx, current());
  const search = new QueritSearchProvider(options);
  const fetch = new QueritFetchProvider(options);

  ctx.web.registerSearchProvider({
    id: search.id,
    title: search.title,
    description: search.description,
    available: () => search.available(),
    ready: () => search.ready(),
    search: (request, signal) => search.search(request, signal),
  });
  ctx.web.registerFetchProvider({
    id: fetch.id,
    title: fetch.title,
    description: fetch.description,
    available: () => fetch.available(),
    ready: () => fetch.ready(),
    fetch: (request, signal) => fetch.fetch(request, signal),
  });

  // This package ships its own page (`plugins.row.config`), so it opts out of
  // the host generating one from the schema.
  ctx.inject(["settings"], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });

  // The model-facing web_fetch tool. Since dsh 0.1.2 the base composition and
  // agent presets register `web_fetch` through their own `tool-web` rows (both
  // web tools route through `ctx.web`, hence Querit), so this opt-in covers
  // only compositions where no other row provides the tool.
  if (config.fetch.get() === true) {
    const { fetchTimeoutMs, fetchMaxOutputChars } = current();
    ctx.inject(["tools", "systemPrompt"], (child) => {
      applyWebFetchTool(child, fetchTimeoutMs ?? DEFAULT_WEB_TOOL_TIMEOUT_MS, fetchMaxOutputChars ?? DEFAULT_FETCH_MAX_OUTPUT_CHARS);
    });
  }

  // First-load configuration prompt: the loudest surface a starting host has
  // is its log. The probe never blocks loading and never throws; a search
  // without a key still fails per call with the actionable
  // WEB_PROVIDER_CREDENTIAL_MISSING message.
  void (async () => {
    try {
      const start = current();
      const apiKeyEnv = credentialRef(start.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
      const configured = (await resolveQueritApiKey(ctx, apiKeyEnv)) !== undefined
        || (start.apiKey?.trim().length ?? 0) > 0;
      if (!configured) {
        ctx.logger.warn(
          `web-search-querit: Querit web search is not configured yet — searches will fail until a key is provided. `
          + `Open the Querit row's page in Settings, or in priority order: set "apiKey" on the web-search-querit row, `
          + `add ${apiKeyEnv} to the credentials store, or (only where no credentials service runs) export `
          + `${apiKeyEnv} in the launching environment. See the dsh-querit README for details.`,
        );
      }
    } catch {
      // Probe-only; provider calls surface credential failures with full detail.
    }
  })();
}

/**
 * Resolve the Querit API key for one operation. An installed credentials
 * service is authoritative, including absence, as it is for the host's own
 * providers; only deployments without that service read the launching
 * environment.
 */
export async function resolveQueritApiKey(ctx: Context, apiKeyEnv: CredentialRef): Promise<string | undefined> {
  const credentials = ctx.get("credentials");
  if (credentials !== undefined) {
    const stored = await credentials.resolve(apiKeyEnv);
    return stored !== undefined && stored.value.length > 0 ? stored.value : undefined;
  }
  const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
  return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
}

/** Whether a key is configured, without resolving the stored value. */
export async function queritApiKeyConfigured(ctx: Context, apiKeyEnv: CredentialRef): Promise<boolean> {
  const credentials = ctx.get("credentials");
  return credentials === undefined
    ? (launchEnvironmentOf(ctx).get(apiKeyEnv)?.value.length ?? 0) > 0
    : (await credentials.describe(apiKeyEnv)).configured;
}

function normalizeTimeRange(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && isTimeRange(trimmed) ? trimmed : undefined;
}

function normalizeEnumList<T extends string>(values: readonly string[] | undefined, allowed: readonly T[]): T[] {
  const allowedSet = new Set<string>(allowed);
  const matched = new Set<T>();
  for (const entry of values ?? []) {
    const normalized = entry.trim().toLowerCase();
    if (allowedSet.has(normalized)) matched.add(normalized as T);
  }
  return [...matched];
}

function normalizeEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return normalizeEnumList(value === undefined ? undefined : [value], allowed)[0];
}
