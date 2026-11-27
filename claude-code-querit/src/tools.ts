import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  QUERIT_CONTENT_MAX_CHARS_LIMIT,
  QUERIT_COUNT_LIMIT,
  QUERIT_HIGHLIGHT_MAX_CHARACTERS,
  QUERIT_HIGHLIGHT_MIN_CHARACTERS,
  QueritClient,
  RANK_VALUES,
  VERTICAL_VALUES,
  type QueritClientOptions,
  type QueritContentsRequest,
  type QueritContentsResponse,
  type QueritHighlights,
  type QueritRankPreference,
  type QueritSearchRequest,
  type QueritSearchResponse,
  type QueritVertical,
} from "./client.js";
import { missingApiKeyMessage, resolveQueritApiKey } from "./config.js";
import { capOutput, formatContentsResponse, formatSearchResponse, safeSlice } from "./format.js";
import { safeErrorMessage } from "./sanitize.js";

const DEFAULT_FETCH_FORMAT = "markdown";
const DEFAULT_FETCH_CRAWL_TIMEOUT = 10;
export const MAX_PAGE_CONTENT_CHARS = 8_000;
const MAX_TOOL_OUTPUT_CHARS = 200_000;

const PAGE_TRUNCATION_MARKER = "\n[Page content truncated by the Querit plugin.]";

export interface WebSearchInput {
  query: string;
  count?: number | undefined;
  highlights?: boolean | undefined;
  highlight_query?: string | undefined;
  highlight_max_chars?: number | undefined;
  need_content?: boolean | undefined;
  max_chars?: number | undefined;
  need_markdown?: boolean | undefined;
  rank?: QueritRankPreference | undefined;
  vertical?: QueritVertical | undefined;
}

export interface FetchContentInput {
  urls: string[];
  format?: QueritContentsRequest["format"] | undefined;
  crawl_timeout?: number | undefined;
  include_metadata?: boolean | undefined;
  max_chars?: number | undefined;
  highlight_query?: string | undefined;
  highlight_max_chars?: number | undefined;
}

export interface QueritClientLike {
  search(request: QueritSearchRequest, signal?: AbortSignal): Promise<QueritSearchResponse>;
  contents(request: QueritContentsRequest, signal?: AbortSignal): Promise<QueritContentsResponse>;
}

export interface QueritToolOptions {
  env?: NodeJS.ProcessEnv | undefined;
  clientFactory?: ((options: QueritClientOptions) => QueritClientLike) | undefined;
}

interface QueritToolHandlers {
  webSearch(input: WebSearchInput, signal?: AbortSignal): Promise<CallToolResult>;
  fetchContent(input: FetchContentInput, signal?: AbortSignal): Promise<CallToolResult>;
}

export function createToolHandlers(options: QueritToolOptions = {}): QueritToolHandlers {
  const env = options.env ?? process.env;
  const clientFactory = options.clientFactory ?? ((clientOptions: QueritClientOptions) => new QueritClient(clientOptions));

  return {
    async webSearch(input, signal) {
      let apiKey: string | undefined;
      try {
        apiKey = requireApiKey(env);
        const search = normalizeSearchInput(input);
        const client = clientFactory({ apiKey });
        const response = await client.search(buildSearchRequest(search), signal);
        const rankDropped = search.rank !== undefined && !acceptsRank(search.vertical);
        return textResult(capOutput(formatSearchResponse(response, { rankDropped }), MAX_TOOL_OUTPUT_CHARS));
      } catch (error) {
        return errorResult(error, apiKey);
      }
    },

    async fetchContent(input, signal) {
      let apiKey: string | undefined;
      try {
        apiKey = requireApiKey(env);
        const urls = normalizeRequestedUrls(input.urls);
        const format = normalizeFormat(input.format);
        const crawlTimeout = normalizeCrawlTimeout(input.crawl_timeout);
        const maxChars = normalizeContentMaxChars(input.max_chars);
        const highlights = buildHighlights(
          normalizeHighlightQuery(input.highlight_query),
          normalizeHighlightMaxChars(input.highlight_max_chars),
        );
        const client = clientFactory({ apiKey });
        const response = await client.contents({
          urls,
          format,
          crawlTimeout,
          extrasMeta: input.include_metadata ?? true,
          ...(maxChars === undefined ? {} : { contentMaxChars: maxChars }),
          ...(highlights ? { highlights } : {}),
        }, signal);
        // Querit enforces an explicit max_chars per URL; without one the plugin caps each page itself.
        const limited = maxChars === undefined ? capPerPage(response, MAX_PAGE_CONTENT_CHARS) : response;
        return textResult(capOutput(
          formatContentsResponse(limited, urls, format),
          MAX_TOOL_OUTPUT_CHARS,
        ));
      } catch (error) {
        return errorResult(error, apiKey);
      }
    },
  };
}

/**
 * Assembles POST /v1/search. Every optional field is omitted unless asked for, so Querit's
 * own defaults (result count, body text, ranking) apply.
 */
export function buildSearchRequest(input: WebSearchInput): QueritSearchRequest {
  const wantsHighlights = input.highlights === true
    || input.highlight_query !== undefined
    || input.highlight_max_chars !== undefined;

  return {
    query: input.query,
    ...(input.count === undefined ? {} : { count: input.count }),
    // The highlights focus on the search query unless another highlight_query is given.
    ...(wantsHighlights
      ? { highlights: buildHighlights(input.highlight_query || input.query, input.highlight_max_chars) }
      : {}),
    ...(input.need_content ? { needContent: true } : {}),
    ...(input.need_content && input.max_chars !== undefined ? { contentMaxChars: input.max_chars } : {}),
    ...(input.need_markdown ? { needMarkdown: true } : {}),
    ...(input.rank && acceptsRank(input.vertical) ? { rank: { preference: input.rank } } : {}),
    ...(input.vertical ? { filters: { vertical: input.vertical } } : {}),
  };
}

/** Assembles the optional `highlights` object from whichever refinement was provided. */
function buildHighlights(query: string | undefined, maxCharacters: number | undefined): QueritHighlights | undefined {
  if (query === undefined && maxCharacters === undefined) return undefined;
  return {
    ...(query === undefined ? {} : { query }),
    ...(maxCharacters === undefined ? {} : { maxCharacters }),
  };
}

/** Querit answers 400 when `rank` is combined with the code vertical, so it is withheld there. */
function acceptsRank(vertical: QueritVertical | undefined): boolean {
  return vertical !== "code";
}

/** Validate and normalize HTTP(S) URLs, rejecting credentials and overlarge batches. */
export function normalizeRequestedUrls(values: readonly string[]): string[] {
  if (values.length === 0) throw new Error("Provide at least one URL to fetch_content.");

  const normalized = new Set<string>();
  for (const value of values) {
    if (value.length > 4_096) throw new Error("Each URL must be at most 4096 characters.");

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("fetch_content received an invalid URL.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("fetch_content accepts only HTTP(S) URLs.");
    }
    if (url.username || url.password) {
      throw new Error("URLs containing embedded credentials are not allowed.");
    }
    normalized.add(url.toString());
  }

  if (normalized.size > 10) throw new Error("fetch_content accepts at most 10 unique URLs.");
  return [...normalized];
}

export function capPerPage(response: QueritContentsResponse, maxChars: number): QueritContentsResponse {
  if (!response.results.some((result) => result.content.length > maxChars)) return response;

  return {
    ...response,
    results: response.results.map((result) => {
      if (result.content.length <= maxChars) return result;
      const bodyLimit = Math.max(0, maxChars - PAGE_TRUNCATION_MARKER.length);
      return {
        ...result,
        content: `${safeSlice(result.content, bodyLimit)}${PAGE_TRUNCATION_MARKER}`,
      };
    }),
  };
}

function normalizeSearchInput(input: WebSearchInput): WebSearchInput {
  const query = normalizeQuery(input.query);
  const count = normalizeCount(input.count);
  const highlights = normalizeBoolean(input.highlights, "highlights");
  const highlightQuery = normalizeHighlightQuery(input.highlight_query);
  const highlightMaxChars = normalizeHighlightMaxChars(input.highlight_max_chars);
  const needContent = normalizeBoolean(input.need_content, "need_content");
  const maxChars = normalizeContentMaxChars(input.max_chars);
  if (maxChars !== undefined && !needContent) {
    throw new Error("max_chars limits the body text, so it requires need_content: true.");
  }

  return {
    query,
    count,
    highlights,
    highlight_query: highlightQuery,
    highlight_max_chars: highlightMaxChars,
    need_content: needContent,
    max_chars: maxChars,
    need_markdown: normalizeBoolean(input.need_markdown, "need_markdown"),
    rank: normalizeEnum(input.rank, RANK_VALUES, "rank"),
    vertical: normalizeEnum(input.vertical, VERTICAL_VALUES, "vertical"),
  };
}

function normalizeQuery(value: string): string {
  const query = value.trim();
  if (!query) throw new Error("Search query cannot be empty.");
  if (query.length > 1_000) throw new Error("Search query must be at most 1000 characters.");
  return query;
}

/** An omitted count is left out so Querit applies its own default. */
function normalizeCount(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > QUERIT_COUNT_LIMIT) {
    throw new Error(`count must be an integer between 1 and ${QUERIT_COUNT_LIMIT}.`);
  }
  return value;
}

function normalizeFormat(value: QueritContentsRequest["format"] | undefined): QueritContentsRequest["format"] {
  const format = value ?? DEFAULT_FETCH_FORMAT;
  if (format !== "text" && format !== "markdown" && format !== "html") {
    throw new Error("format must be one of: text, markdown, html.");
  }
  return format;
}

function normalizeCrawlTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_FETCH_CRAWL_TIMEOUT;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60) {
    throw new Error("crawl_timeout must be an integer between 1 and 60 seconds.");
  }
  return timeout;
}

function normalizeBoolean(value: boolean | undefined, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
  return value;
}

function normalizeContentMaxChars(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > QUERIT_CONTENT_MAX_CHARS_LIMIT) {
    throw new Error(`max_chars must be an integer between 1 and ${QUERIT_CONTENT_MAX_CHARS_LIMIT}.`);
  }
  return value;
}

function normalizeHighlightQuery(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const query = value.trim();
  if (!query) throw new Error("highlight_query cannot be empty.");
  if (query.length > 1_000) throw new Error("highlight_query must be at most 1000 characters.");
  return query;
}

function normalizeHighlightMaxChars(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < QUERIT_HIGHLIGHT_MIN_CHARACTERS || value > QUERIT_HIGHLIGHT_MAX_CHARACTERS) {
    throw new Error(
      `highlight_max_chars must be an integer between ${QUERIT_HIGHLIGHT_MIN_CHARACTERS} and ${QUERIT_HIGHLIGHT_MAX_CHARACTERS}.`,
    );
  }
  return value;
}

function normalizeEnum<T extends string>(value: T | undefined, allowed: readonly T[], name: string): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function requireApiKey(env: NodeJS.ProcessEnv): string {
  const apiKey = resolveQueritApiKey(env);
  if (!apiKey) throw new Error(missingApiKeyMessage());
  return apiKey;
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(error: unknown, apiKey: string | undefined): CallToolResult {
  return {
    content: [{
      type: "text",
      text: `Querit tool error: ${safeErrorMessage(error, [apiKey])}`,
    }],
    isError: true,
  };
}
