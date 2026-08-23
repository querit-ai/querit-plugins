import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  QueritClient,
  type QueritClientOptions,
  type QueritContentsRequest,
  type QueritContentsResponse,
  type QueritSearchRequest,
  type QueritSearchResponse,
} from "./client.js";
import { missingApiKeyMessage, resolveQueritApiKey } from "./config.js";
import { capOutput, formatContentsResponse, formatSearchResponse, safeSlice } from "./format.js";
import { safeErrorMessage } from "./sanitize.js";

export const DEFAULT_SEARCH_COUNT = 5;
export const DEFAULT_FETCH_FORMAT = "markdown";
export const DEFAULT_FETCH_CRAWL_TIMEOUT = 10;
export const MAX_PAGE_CONTENT_CHARS = 8_000;
export const MAX_TOOL_OUTPUT_CHARS = 200_000;

const PAGE_TRUNCATION_MARKER = "\n[Page content truncated by the Querit plugin.]";

export type ContentFormat = "text" | "markdown" | "html";

export interface WebSearchInput {
  query: string;
  count?: number | undefined;
}

export interface FetchContentInput {
  urls: string[];
  format?: ContentFormat | undefined;
  crawl_timeout?: number | undefined;
  include_metadata?: boolean | undefined;
}

export interface QueritClientLike {
  search(request: QueritSearchRequest, signal?: AbortSignal): Promise<QueritSearchResponse>;
  contents(request: QueritContentsRequest, signal?: AbortSignal): Promise<QueritContentsResponse>;
}

export interface QueritToolOptions {
  env?: NodeJS.ProcessEnv | undefined;
  clientFactory?: ((options: QueritClientOptions) => QueritClientLike) | undefined;
}

export interface QueritToolHandlers {
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
        const query = normalizeQuery(input.query);
        const count = normalizeCount(input.count);
        const client = clientFactory({ apiKey });
        const response = await client.search(buildSearchRequest(query, count), signal);
        return textResult(capOutput(formatSearchResponse(response), MAX_TOOL_OUTPUT_CHARS));
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
        const client = clientFactory({ apiKey });
        const response = await client.contents({
          urls,
          format,
          crawlTimeout,
          extrasMeta: input.include_metadata ?? true,
        }, signal);
        const limited = capPerPage(response, MAX_PAGE_CONTENT_CHARS);
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

export function buildSearchRequest(query: string, count = DEFAULT_SEARCH_COUNT): QueritSearchRequest {
  return {
    query,
    count,
    chunksPerDoc: 1,
    needContent: false,
  };
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

function normalizeQuery(value: string): string {
  const query = value.trim();
  if (!query) throw new Error("Search query cannot be empty.");
  if (query.length > 1_000) throw new Error("Search query must be at most 1000 characters.");
  return query;
}

function normalizeCount(value: number | undefined): number {
  const count = value ?? DEFAULT_SEARCH_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error("count must be an integer between 1 and 20.");
  }
  return count;
}

function normalizeFormat(value: ContentFormat | undefined): ContentFormat {
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
