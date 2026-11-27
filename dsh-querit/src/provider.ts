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
import { WebError } from "@deepseek-ai/dsh-web";
import type { CredentialRef } from "@deepseek-ai/dsh-credentials";
import {
  QUERIT_COUNT_LIMIT,
  QueritClient,
  formatCost,
  type QueritClientOptions,
  type QueritContentsRequest,
  type QueritContentsResponse,
  type QueritRankPreference,
  type QueritResourceTag,
  type QueritSearchRequest,
  type QueritSearchResponse,
  type QueritVertical,
} from "./client.js";
import { sanitizeErrorMessage } from "./sanitize.js";

/** Stable id both providers register under, mirroring the native `web-search-deepseek` row naming. */
export const QUERIT_PROVIDER_ID = "web-search-querit";

/** What the provider picker and the plugin page show. */
const QUERIT_PROVIDER_TITLE = "Querit";

/** What the provider picker shows under the provider when it is selected. */
const QUERIT_PROVIDER_DESCRIPTION: LocalizedText = {
  en: "Live web search and page fetch through the Querit API. Needs a QUERIT_API_KEY credential. Querit bills per search and per fetched page.",
  zh: "通过 Querit API 进行实时网页搜索与网页抓取。需要 QUERIT_API_KEY 凭据。Querit 按搜索次数和抓取页数计费。",
};

export const COUNTRY_VALUES = [
  "argentina",
  "australia",
  "brazil",
  "canada",
  "colombia",
  "france",
  "germany",
  "india",
  "indonesia",
  "japan",
  "mexico",
  "nigeria",
  "philippines",
  "south korea",
  "spain",
  "united kingdom",
  "united states",
] as const;

export const LANGUAGE_VALUES = [
  "english",
  "japanese",
  "korean",
  "german",
  "french",
  "spanish",
  "portuguese",
  "russian",
] as const;

/** `dN`/`wN`/`mN`/`yN` (N ≥ 1) or an inclusive `YYYY-MM-DDtoYYYY-MM-DD` range. */
const TIME_RANGE_PATTERN = /^(?:[dwmy][1-9][0-9]*|\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2})$/u;

/** Cap on one source's display snippet, in chars. */
const SNIPPET_MAX_CHARS = 512;
/** Cap on one source's model-facing summary (highlights and body excerpts), in chars. */
const SUMMARY_MAX_CHARS = 4_096;

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

export function isTimeRange(value: unknown): value is string {
  return typeof value === "string" && TIME_RANGE_PATTERN.test(value.trim());
}

/**
 * Normalize a configured hostname list: lowercase, drop schemes/ports/paths,
 * and keep at most 100 unique entries. Invalid entries are dropped.
 */
export function normalizeDomains(values: readonly string[] | undefined): string[] {
  const domains = new Set<string>();
  for (const entry of values ?? []) {
    const host = normalizeHostname(entry);
    if (host) domains.add(host);
    if (domains.size >= 100) break;
  }
  return [...domains];
}

/** One hostname from a configured entry, or undefined for what cannot be a host. */
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

/** Whether the options carry what an operation needs before it can talk to Querit. */
function coreUsable(options: QueritProviderOptions): boolean {
  if (!URL.canParse(options.baseURL)) return false;
  if ((options.apiKey?.length ?? 0) === 0 && options.resolveApiKey === undefined) return false;
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) return false;
  return true;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function truncateChars(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 3)}...`;
}

/** The display line: the snippet alone, whitespace collapsed. */
function displaySnippet(result: QueritSearchResponse["results"][number]): string {
  const snippet = result.snippetMarkdown?.length
    ? result.snippetMarkdown.join(" ")
    : result.snippet;
  return truncateChars(snippet.replace(/\s+/gu, " ").trim(), SNIPPET_MAX_CHARS);
}

/**
 * The model-facing line. Highlights lead because Querit selects them against
 * the query; body text follows for context when it was requested.
 */
function modelSummary(result: QueritSearchResponse["results"][number]): string {
  if (result.contentMarkdown) return truncateChars(result.contentMarkdown.trim(), SUMMARY_MAX_CHARS);
  const parts: string[] = [];
  for (const highlight of result.highlights) {
    if (highlight.trim()) parts.push(highlight.trim());
  }
  for (const sentence of result.sentences) {
    if (sentence.trim()) parts.push(`- ${sentence.trim()}`);
  }
  return truncateChars(parts.join("\n"), SUMMARY_MAX_CHARS);
}

export class QueritSearchProvider implements WebSearchProvider {
  readonly id = QUERIT_PROVIDER_ID;
  readonly title = QUERIT_PROVIDER_TITLE;
  readonly description = QUERIT_PROVIDER_DESCRIPTION;

  /**
   * @param resolveOptions - options for the NEXT operation, snapshotted once
   * at each operation's entry so one search never mixes two settings sections.
   */
  constructor(private readonly resolveOptions: () => QueritProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions();
    if (!coreUsable(options)) return false;
    if (options.count !== undefined && (!Number.isInteger(options.count) || options.count < 1 || options.count > QUERIT_COUNT_LIMIT)) {
      return false;
    }
    if (options.chunksPerDoc !== undefined && (!Number.isInteger(options.chunksPerDoc) || options.chunksPerDoc < 1 || options.chunksPerDoc > 3)) {
      return false;
    }
    if (options.timeRange !== undefined && !isTimeRange(options.timeRange)) return false;
    return true;
  }

  /** Whether a search now would have a key to send; configuration only, no network. */
  async ready(): Promise<boolean> {
    return hasApiKey(this.resolveOptions());
  }

  async search(
    request: { query: string; maxResults?: number; llmProvider?: string },
    signal?: AbortSignal,
  ): Promise<WebSearchResult> {
    throwIfAborted(signal);
    const options = this.resolveOptions();
    const client = await createClient(options, signal);

    const filters: NonNullable<QueritSearchRequest["filters"]> = {};
    const sites = {
      ...(options.includeDomains.length > 0 ? { include: options.includeDomains } : {}),
      ...(options.excludeDomains.length > 0 ? { exclude: options.excludeDomains } : {}),
    };
    if (Object.keys(sites).length > 0) filters.sites = sites;
    if (options.timeRange) filters.timeRange = { date: options.timeRange };
    if (options.countries.length > 0) filters.geo = { countries: { include: options.countries } };
    if (options.languages.length > 0) filters.languages = { include: options.languages };
    if (options.vertical) filters.vertical = options.vertical;
    if (options.vertical === "code" && options.resourceTags.length > 0) {
      filters.resourceTags = { include: options.resourceTags };
    }

    // The seam enforces its bound regardless; asking Querit for the same count
    // keeps the cost and latency of the request proportional to what is used.
    const count = request.maxResults === undefined ? options.count : clampInteger(request.maxResults, 1, QUERIT_COUNT_LIMIT);

    let response: QueritSearchResponse;
    try {
      response = await client.search({
        query: request.query,
        ...(count === undefined ? {} : { count }),
        // Deprecated by Querit; forwarded only for deployments that set it before highlights existed.
        ...(options.chunksPerDoc === undefined ? {} : { chunksPerDoc: options.chunksPerDoc }),
        ...(options.highlights ? { highlights: true } : {}),
        needContent: options.includeContent,
        ...(options.includeContent && options.contentMaxChars !== undefined ? { contentMaxChars: options.contentMaxChars } : {}),
        ...(options.needMarkdown ? { needMarkdown: true } : {}),
        // The code vertical rejects rank with a 400.
        ...(options.rank && options.vertical !== "code" ? { rank: { preference: options.rank } } : {}),
        ...(Object.keys(filters).length === 0 ? {} : { filters }),
      }, signal);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error);
      throw new WebError(`Querit search failed: ${sanitizeErrorMessage(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }

    options.observe?.({
      operation: "search",
      ...(response.searchId ? { searchId: response.searchId } : {}),
      ...(response.took ? { took: response.took } : {}),
      ...(response.cost ? { cost: formatCost(response.cost) } : {}),
    });

    const sources = response.results.map((result) => {
      const snippet = displaySnippet(result);
      const summary = modelSummary(result);
      return {
        url: result.url,
        ...(result.title && result.title !== result.url ? { title: result.title } : {}),
        ...(snippet ? { snippet } : {}),
        ...(summary ? { summary } : {}),
        ...(result.pageAge ? { publishedAt: result.pageAge } : {}),
      };
    });

    return { sources, truncated: false };
  }
}

export class QueritFetchProvider implements WebFetchProvider {
  readonly id = QUERIT_PROVIDER_ID;
  readonly title = QUERIT_PROVIDER_TITLE;
  readonly description = QUERIT_PROVIDER_DESCRIPTION;

  constructor(private readonly resolveOptions: () => QueritProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions();
    if (!coreUsable(options)) return false;
    if (!Number.isInteger(options.fetchCrawlTimeout) || options.fetchCrawlTimeout < 1 || options.fetchCrawlTimeout > 60) return false;
    if (!Number.isInteger(options.fetchMaxChars) || options.fetchMaxChars < 256) return false;
    return true;
  }

  /** Whether a fetch now would have a key to send; configuration only, no network. */
  async ready(): Promise<boolean> {
    return hasApiKey(this.resolveOptions());
  }

  async fetch(request: { url: string }, signal?: AbortSignal): Promise<WebFetchResult> {
    throwIfAborted(signal);
    const options = this.resolveOptions();
    const client = await createClient(options, signal);

    let response: QueritContentsResponse;
    try {
      response = await client.contents({
        urls: [request.url],
        format: options.fetchFormat,
        crawlTimeout: options.fetchCrawlTimeout,
        extrasMeta: false,
      }, signal);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error);
      throw new WebError(`Querit fetch failed: ${sanitizeErrorMessage(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }

    options.observe?.({
      operation: "fetch",
      ...(response.searchId ? { searchId: response.searchId } : {}),
      ...(response.searchTime === undefined ? {} : { took: `${response.searchTime}s` }),
      ...(response.cost ? { cost: formatCost(response.cost) } : {}),
    });

    // Match a status to its result by id, not by array position: not every
    // requested URL produces a result.
    const result = response.results.find((item) => item.content.length > 0) ?? response.results[0];
    const succeeded = response.statuses.some((status) => status.status === "success");
    if (succeeded && result !== undefined && result.content.length > 0) {
      const truncated = result.content.length > options.fetchMaxChars;
      const content = truncated ? `${result.content.slice(0, options.fetchMaxChars - 3)}...` : result.content;
      return {
        url: result.url,
        statusCode: 200,
        body: { kind: options.fetchFormat === "html" ? "html" : "text", content },
        truncated,
      };
    }

    const failed = response.statuses.find((status) => status.status !== undefined && status.status !== "success");
    throw new WebError(
      failed ? `Querit could not retrieve the page: ${failed.status}` : "Querit returned no content for the requested URL.",
      "WEB_PROVIDER_ERROR",
    );
  }
}

async function hasApiKey(options: QueritProviderOptions): Promise<boolean> {
  if (options.apiKey !== undefined && options.apiKey.length > 0) return true;
  try {
    if (options.apiKeyConfigured !== undefined) return await options.apiKeyConfigured();
    return (await options.resolveApiKey?.()) !== undefined;
  } catch {
    // A store that cannot be read supplies no key to the operation either.
    return false;
  }
}

/**
 * Resolve the credential for one operation and build the client around it.
 * Credential reads are raced against cancellation so an aborted call never
 * waits on the store.
 */
async function createClient(options: QueritProviderOptions, signal?: AbortSignal): Promise<QueritClientLike> {
  throwIfAborted(signal);
  let apiKey = options.apiKey;
  if (apiKey === undefined || apiKey.length === 0) {
    let resolved: string | undefined;
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error);
      throw new WebError(`Querit credential resolution failed: ${sanitizeErrorMessage(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }
    apiKey = resolved;
  }
  if (apiKey === undefined || apiKey.length === 0) {
    throw new WebError(
      `Querit has no API key for "${options.apiKeyEnv ?? "QUERIT_API_KEY"}". Set it on the Querit row's page in Settings, `
      + `or configure it in priority order: a literal "apiKey" on the web-search-querit row, the credentials store, or `
      + `(only where no credentials service runs) the launching environment. See the dsh-querit README for details.`,
      "WEB_PROVIDER_CREDENTIAL_MISSING",
    );
  }

  const clientOptions = { apiKey, baseUrl: options.baseURL, timeoutMs: options.timeoutMs };
  return options.clientFactory?.(clientOptions) ?? new QueritClient(clientOptions);
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable(operation: Promise<string | undefined>, signal?: AbortSignal): Promise<string | undefined> {
  if (signal === undefined) return operation;
  if (signal.aborted) return Promise.reject(aborted(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then((value) => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(sanitizeErrorMessage(error), { cause: error }));
    });
  });
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw aborted(signal);
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function aborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError("Querit request aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
