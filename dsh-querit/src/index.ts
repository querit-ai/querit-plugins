/**
 * Register Querit-backed search and fetch providers in `ctx.web`.
 * Both providers call the public Querit API (`POST /v1/search`,
 * `POST /v1/contents`) with a Bearer key resolved per operation from the
 * launching environment, then optional `ctx.credentials`, then literal config.
 * The agent preset registers model-facing `web_search`; this package does not.
 * By default, it reuses the official `applyWebFetchTool` helper to register
 * `web_fetch`, and both tools route through the seam.
 * @module dsh-querit
 */
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { credentialRef, type CredentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import {
  DEFAULT_FETCH_MAX_OUTPUT_CHARS,
  DEFAULT_WEB_TOOL_TIMEOUT_MS,
  applyWebFetchTool,
} from "@deepseek-ai/dsh-tool-web";
import { DEFAULT_REQUEST_TIMEOUT_MS, QUERIT_API_BASE_URL } from "./client.js";
import {
  COUNTRY_VALUES,
  LANGUAGE_VALUES,
  QueritFetchProvider,
  QueritSearchProvider,
  isTimeRange,
  normalizeDomains,
  type QueritProviderOptions,
} from "./provider.js";

export {
  COUNTRY_VALUES,
  LANGUAGE_VALUES,
  QUERIT_PROVIDER_ID,
  TIME_RANGE_PATTERN,
  QueritFetchProvider,
  QueritSearchProvider,
} from "./provider.js";
export type { QueritClientLike, QueritProviderOptions } from "./provider.js";

/** Cordis plugin name used by loader diagnostics. */
export const name = "web-search-querit";
/**
 * The web seam both providers register into, plus the registries the optional
 * model-facing `web_fetch` tool needs (reused from `@deepseek-ai/dsh-tool-web`).
 */
export const inject = ["web", "tools", "systemPrompt"];

export const DEFAULT_API_KEY_ENV = "QUERIT_API_KEY";
const BASE_URL_ENV = "QUERIT_BASE_URL";

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

export const Config = z.object({
  apiKey: z.string().role("secret"),
  apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  timeoutMs: z.number().step(1).min(1_000).default(DEFAULT_REQUEST_TIMEOUT_MS),
  count: z.number().step(1).min(1).max(20).default(5),
  timeRange: z.string(),
  countries: z.array(z.string()),
  languages: z.array(z.string()),
  includeDomains: z.array(z.string()),
  excludeDomains: z.array(z.string()),
  includeContent: z.boolean().default(false),
  chunksPerDoc: z.number().step(1).min(1).max(3).default(1),
  fetchFormat: z.union([z.const("markdown"), z.const("text"), z.const("html")]).default("markdown"),
  fetchCrawlTimeout: z.number().step(1).min(1).max(60).default(10),
  fetchMaxChars: z.number().step(1).min(256).default(8_000),
  fetch: z.boolean().default(true),
  fetchTimeoutMs: z.number().step(1).min(1_000).default(DEFAULT_WEB_TOOL_TIMEOUT_MS),
  fetchMaxOutputChars: z.number().step(1).min(256).default(DEFAULT_FETCH_MAX_OUTPUT_CHARS),
}) as z<Config>;

/** Settings namespace carrying this provider's endpoint, key reference, and search defaults. */
export const WEB_SEARCH_QUERIT_SETTINGS_NAMESPACE = settingsNamespace("web-search-querit");

/**
 * Project one resolved section into the options both providers serve their
 * next operation with. Environment fallbacks stay here rather than in the
 * providers: every value they read is already fully defaulted.
 */
export function resolveOptions(ctx: Context, config: Config): QueritProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
  const literalApiKey = config.apiKey !== undefined && config.apiKey.trim().length > 0
    ? config.apiKey.trim()
    : undefined;
  const environment = launchEnvironmentOf(ctx);

  return {
    resolveApiKey: () => resolveQueritApiKey(ctx, apiKeyEnv, literalApiKey),
    apiKeyEnv,
    baseURL: (config.baseURL ?? environment.get(BASE_URL_ENV)?.value ?? QUERIT_API_BASE_URL).replace(/\/+$/, ""),
    timeoutMs: config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    count: config.count ?? 5,
    timeRange: normalizeTimeRange(config.timeRange),
    countries: normalizeEnumList(config.countries, COUNTRY_VALUES),
    languages: normalizeEnumList(config.languages, LANGUAGE_VALUES),
    includeDomains: normalizeDomains(config.includeDomains),
    excludeDomains: normalizeDomains(config.excludeDomains),
    includeContent: config.includeContent ?? false,
    chunksPerDoc: config.chunksPerDoc ?? 1,
    fetchFormat: config.fetchFormat ?? "markdown",
    fetchCrawlTimeout: config.fetchCrawlTimeout ?? 10,
    fetchMaxChars: config.fetchMaxChars ?? 8_000,
  };
}

/** Register both Querit providers with `ctx.web`, the `web_fetch` tool, and the first-load key check. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  let current = () => config;
  installSettingsSection(ctx, WEB_SEARCH_QUERIT_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source;
    },
    onChange: () => {},
    validate: (value) => validateSection(value),
  });
  ctx.web.registerSearchProvider(new QueritSearchProvider(() => resolveOptions(ctx, current())));
  ctx.web.registerFetchProvider(new QueritFetchProvider(() => resolveOptions(ctx, current())));

  // The model-facing web_fetch tool. In this deployment's web app the host
  // `tool-web` row is disabled and the shipped presets keep `fetch: false`, so
  // this package owns the one global registration; `fetch: false` opts out when
  // a preset already registers it.
  if (config.fetch !== false) {
    applyWebFetchTool(
      ctx,
      config.fetchTimeoutMs ?? DEFAULT_WEB_TOOL_TIMEOUT_MS,
      config.fetchMaxOutputChars ?? DEFAULT_FETCH_MAX_OUTPUT_CHARS,
    );
  }

  // First-load configuration prompt: this deployment has no settings page for
  // out-of-tree plugins, so the loudest surface available is the host log. The
  // probe never blocks loading and never throws; a search without a key still
  // fails per call with the actionable WEB_PROVIDER_CREDENTIAL_MISSING message.
  try {
    const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
    const literalApiKey = config.apiKey !== undefined && config.apiKey.trim().length > 0
      ? config.apiKey.trim()
      : undefined;
    const key = await resolveQueritApiKey(ctx, apiKeyEnv, literalApiKey);
    if (key === undefined) {
      ctx.logger.warn(
        `web-search-querit: Querit web search is not configured yet — searches will fail until a key is provided. ` +
          `In priority order: export ${apiKeyEnv} in the launching environment, add it to the credentials store ` +
          `($DSH_HOME/.credentials.yaml), or set "apiKey" on the web-search-querit row. See the dsh-querit README for details.`,
      );
    }
  } catch {
    // Probe-only; provider calls surface credential failures with full detail.
  }
}

/**
 * Resolve the Querit API key for one operation in priority order: the
 * launching environment (so one exported `QUERIT_API_KEY` overrides
 * everything for testing), then the credentials service (which itself reads
 * the inherited environment before the managed document), then a literal row
 * `apiKey`.
 */
export async function resolveQueritApiKey(
  ctx: Context,
  apiKeyEnv: CredentialRef,
  literalApiKey: string | undefined,
): Promise<string | undefined> {
  const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
  if (ambient !== undefined && ambient.value.length > 0) return ambient.value;
  const credentials = ctx.get("credentials");
  if (credentials !== undefined) {
    const stored = await credentials.resolve(apiKeyEnv);
    if (stored !== undefined && stored.value.length > 0) return stored.value;
  }
  return literalApiKey !== undefined && literalApiKey.length > 0 ? literalApiKey : undefined;
}

/**
 * Reject a resolved settings section this plugin could not act on, for
 * constraints the schema cannot express. Throwing here keeps the settings UI
 * from committing an invalid section while the previous good value stays live.
 */
export function validateSection(value: Config): void {
  if (value.baseURL !== undefined && !URL.canParse(value.baseURL)) {
    throw new Error("baseURL must be a parseable HTTP(S) URL.");
  }
  if (value.timeRange !== undefined && !isTimeRange(value.timeRange)) {
    throw new Error("timeRange must be a relative range (d7, w2, m3, y1, ...) or YYYY-MM-DDtoYYYY-MM-DD.");
  }
  if (value.countries !== undefined) rejectUnknownValues(value.countries, COUNTRY_VALUES, "countries");
  if (value.languages !== undefined) rejectUnknownValues(value.languages, LANGUAGE_VALUES, "languages");
  if (value.includeDomains !== undefined) rejectInvalidDomains(value.includeDomains, "includeDomains");
  if (value.excludeDomains !== undefined) rejectInvalidDomains(value.excludeDomains, "excludeDomains");
}

function normalizeTimeRange(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeEnumList<T extends string>(values: string[] | undefined, allowed: readonly T[]): T[] {
  const allowedSet = new Set<string>(allowed);
  const matched = new Set<T>();
  for (const entry of values ?? []) {
    const normalized = entry.trim().toLowerCase();
    if (allowedSet.has(normalized)) matched.add(normalized as T);
  }
  return [...matched];
}

function rejectUnknownValues(values: string[], allowed: readonly string[], field: string): void {
  const allowedSet = new Set<string>(allowed);
  const unknown = [...new Set(values.map((value) => value.trim().toLowerCase()))].filter((value) => !allowedSet.has(value));
  if (unknown.length > 0) {
    throw new Error(`${field} contains unsupported values: ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}.`);
  }
}

function rejectInvalidDomains(values: string[], field: string): void {
  const invalid = values.filter((value) => {
    const trimmed = value.trim().toLowerCase();
    return trimmed.length === 0 || trimmed.length > 253 || /\s/u.test(trimmed) || !trimmed.includes(".");
  });
  if (invalid.length > 0) {
    throw new Error(`${field} contains invalid hostnames: ${invalid.join(", ")}. Use bare hostnames like github.com.`);
  }
}
