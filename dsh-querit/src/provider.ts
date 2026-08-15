/**
 * Querit-backed `WebSearchProvider` and `WebFetchProvider` for the harness web
 * capability seam (`ctx.web`). Each search resolves the credential for the
 * NEXT operation, honors the caller's `AbortSignal`, maps failures to the
 * seam's `WebError` taxonomy, and never emits provider-generated answer text
 * as trusted `content` — only citeable sources.
 * @module dsh-querit/provider
 */
import type { WebFetchProvider, WebFetchResult, WebSearchProvider, WebSearchResult } from "@deepseek-ai/dsh-web";
import { WebError } from "@deepseek-ai/dsh-web";
import type { CredentialRef } from "@deepseek-ai/dsh-credentials";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  QueritApiError,
  QueritClient,
  type QueritClientOptions,
  type QueritContentsRequest,
  type QueritContentsResponse,
  type QueritSearchRequest,
  type QueritSearchResponse,
} from "./client.js";

/** Stable id both providers register under. */
export const QUERIT_PROVIDER_ID = "querit";

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
] as const;

/** `dN`/`wN`/`mN`/`yN` (N ≥ 1) or an inclusive `YYYY-MM-DDtoYYYY-MM-DD` range. */
export const TIME_RANGE_PATTERN = /^(?:[dwmy][1-9][0-9]*|\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2})$/u;

/** Cap on one source's merged snippet + sentence excerpts, in chars. */
const SNIPPET_MAX_CHARS = 4_096;

export interface QueritClientLike {
  search(request: QueritSearchRequest, signal?: AbortSignal): Promise<QueritSearchResponse>;
  contents(request: QueritContentsRequest, signal?: AbortSignal): Promise<QueritContentsResponse>;
}

export interface QueritProviderOptions {
  /** Literal Querit API key; when present it wins over `resolveApiKey`. */
  apiKey?: string;
  /** Resolve the current Querit API key for one operation. */
  resolveApiKey?: () => Promise<string | undefined>;
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef;
  /** Querit API base URL (`/v1/search` and `/v1/contents` are appended). */
  baseURL: string;
  /** Per-request timeout in ms. */
  timeoutMs: number;
  /** Result count used when the seam passes no `maxResults` bound. */
  count: number;
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
  /** Request sentence-level content excerpts (`needContent`). */
  includeContent: boolean;
  /** Content chunks per result, 1–3. */
  chunksPerDoc: number;
  /** Format requested from `/v1/contents` for fetch calls. */
  fetchFormat: "markdown" | "text" | "html";
  /** Per-page crawl timeout in seconds, 1–60. */
  fetchCrawlTimeout: number;
  /** Cap applied to one fetched page's decoded body, in chars. */
  fetchMaxChars: number;
  /** Client factory used by tests; defaults to `QueritClient`. */
  clientFactory?: (options: QueritClientOptions) => QueritClientLike;
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

export function normalizeHostname(value: string): string | undefined {
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

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function mergeSnippet(result: { snippet: string; sentences: string[] }): string {
  const parts: string[] = [];
  if (result.snippet.trim()) parts.push(result.snippet.trim());
  for (const sentence of result.sentences) {
    const trimmed = sentence.trim();
    if (trimmed) parts.push(`- ${trimmed}`);
  }
  const merged = parts.join("\n");
  return merged.length <= SNIPPET_MAX_CHARS ? merged : `${merged.slice(0, SNIPPET_MAX_CHARS - 3)}...`;
}

export class QueritSearchProvider implements WebSearchProvider {
  readonly id = QUERIT_PROVIDER_ID;

  /**
   * @param resolveOptions - options for the NEXT operation, snapshotted once
   * at each operation's entry so one search never mixes two settings sections.
   */
  constructor(private readonly resolveOptions: () => QueritProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions();
    if (!URL.canParse(options.baseURL)) return false;
    if ((options.apiKey?.length ?? 0) === 0 && options.resolveApiKey === undefined) return false;
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) return false;
    if (!Number.isInteger(options.count) || options.count < 1 || options.count > 20) return false;
    if (!Number.isInteger(options.chunksPerDoc) || options.chunksPerDoc < 1 || options.chunksPerDoc > 3) return false;
    if (options.timeRange !== undefined && !isTimeRange(options.timeRange)) return false;
    return true;
  }

  async search(request: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<WebSearchResult> {
    throwIfAborted(signal);
    const options = this.resolveOptions();
    const client = await this.client(options, signal);

    const filters: NonNullable<QueritSearchRequest["filters"]> = {};
    if (options.includeDomains.length > 0 || options.excludeDomains.length > 0) {
      filters.sites = {
        ...(options.includeDomains.length > 0 ? { include: options.includeDomains } : {}),
        ...(options.excludeDomains.length > 0 ? { exclude: options.excludeDomains } : {}),
      };
    }
    if (options.timeRange) filters.timeRange = { date: options.timeRange };
    if (options.countries.length > 0) filters.geo = { countries: { include: options.countries } };
    if (options.languages.length > 0) filters.languages = { include: options.languages };

    const count = clampInteger(request.maxResults ?? options.count, 1, 20);
    let response: QueritSearchResponse;
    try {
      response = await client.search({
        query: request.query,
        count,
        chunksPerDoc: options.chunksPerDoc,
        needContent: options.includeContent,
        ...(Object.keys(filters).length === 0 ? {} : { filters }),
      }, signal);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error);
      throw new WebError(`Querit search failed: ${errorMessage(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }

    const sources = response.results.map((result) => ({
      url: result.url,
      ...(result.title && result.title !== result.url ? { title: result.title } : {}),
      ...(mergeSnippet(result) ? { snippet: mergeSnippet(result) } : {}),
      ...(result.pageAge ? { publishedAt: result.pageAge } : {}),
    }));

    return { sources, truncated: false };
  }

  private async client(options: QueritProviderOptions, signal?: AbortSignal): Promise<QueritClientLike> {
    throwIfAborted(signal);
    let apiKey = options.apiKey;
    if (apiKey === undefined || apiKey.length === 0) {
      let resolved: string | undefined;
      try {
        resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal);
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error);
        throw new WebError(`Querit credential resolution failed: ${errorMessage(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
      }
      apiKey = resolved;
    }
    if (apiKey === undefined || apiKey.length === 0) {
      throw new WebError(
        `Querit has no API key for "${options.apiKeyEnv ?? "QUERIT_API_KEY"}". Configure it in priority order: export it in the launching environment, add it to the credentials store ($DSH_HOME/.credentials.yaml), or set a literal "apiKey" on the web-search-querit row. See the dsh-querit README for details.`,
        "WEB_PROVIDER_CREDENTIAL_MISSING",
      );
    }

    return options.clientFactory?.({ apiKey, baseUrl: options.baseURL, timeoutMs: options.timeoutMs })
      ?? new QueritClient({ apiKey, baseUrl: options.baseURL, timeoutMs: options.timeoutMs });
  }
}

export class QueritFetchProvider implements WebFetchProvider {
  readonly id = QUERIT_PROVIDER_ID;

  constructor(private readonly resolveOptions: () => QueritProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions();
    if (!URL.canParse(options.baseURL)) return false;
    if ((options.apiKey?.length ?? 0) === 0 && options.resolveApiKey === undefined) return false;
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) return false;
    if (!Number.isInteger(options.fetchCrawlTimeout) || options.fetchCrawlTimeout < 1 || options.fetchCrawlTimeout > 60) return false;
    if (!Number.isInteger(options.fetchMaxChars) || options.fetchMaxChars < 256) return false;
    return true;
  }

  async fetch(request: { url: string }, signal?: AbortSignal): Promise<WebFetchResult> {
    throwIfAborted(signal);
    const options = this.resolveOptions();
    const client = await this.client(options, signal);

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
      throw new WebError(`Querit fetch failed: ${errorMessage(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }

    const succeeded = response.statuses.some((status) => status.status === "success");
    const result = response.results.find((item) => item.content.length > 0) ?? response.results[0];
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

  private async client(options: QueritProviderOptions, signal?: AbortSignal): Promise<QueritClientLike> {
    throwIfAborted(signal);
    let apiKey = options.apiKey;
    if (apiKey === undefined || apiKey.length === 0) {
      let resolved: string | undefined;
      try {
        resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal);
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error);
        throw new WebError(`Querit credential resolution failed: ${errorMessage(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
      }
      apiKey = resolved;
    }
    if (apiKey === undefined || apiKey.length === 0) {
      throw new WebError(
        `Querit has no API key for "${options.apiKeyEnv ?? "QUERIT_API_KEY"}". Configure it in priority order: export it in the launching environment, add it to the credentials store ($DSH_HOME/.credentials.yaml), or set a literal "apiKey" on the web-search-querit row. See the dsh-querit README for details.`,
        "WEB_PROVIDER_CREDENTIAL_MISSING",
      );
    }

    return options.clientFactory?.({ apiKey, baseUrl: options.baseURL, timeoutMs: options.timeoutMs })
      ?? new QueritClient({ apiKey, baseUrl: options.baseURL, timeoutMs: options.timeoutMs });
  }
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
      reject(new Error(errorMessage(error), { cause: error }));
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

function errorMessage(error: unknown): string {
  if (error instanceof QueritApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
