import { describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { QueritContentsResponse, QueritSearchResponse } from "../src/client.js";
import { LOCAL_API_KEY_ENV, resolveQueritApiKey } from "../src/config.js";
import {
  MAX_PAGE_CONTENT_CHARS,
  buildSearchRequest,
  capPerPage,
  createToolHandlers,
  normalizeRequestedUrls,
  type QueritClientLike,
} from "../src/tools.js";

const PLUGIN_KEY = "plugin-key-placeholder";
const LOCAL_KEY = "local-key-placeholder";

function searchResponse(overrides: Partial<QueritSearchResponse> = {}): QueritSearchResponse {
  return {
    searchId: "42",
    query: "test",
    results: [{ title: "Result", url: "https://example.com/a", snippet: "snippet", sentences: [] }],
    ...overrides,
  };
}

function contentsResponse(overrides: Partial<QueritContentsResponse> = {}): QueritContentsResponse {
  return {
    searchId: "7",
    results: [{ id: "1", url: "https://example.com/page", content: "page body" }],
    statuses: [{ id: "1", status: "success" }],
    ...overrides,
  };
}

function resultText(result: CallToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") throw new Error("Expected text tool content.");
  return first.text;
}

describe("API key resolution", () => {
  it("trims QUERIT_API_KEY from the environment", () => {
    expect(resolveQueritApiKey({ [LOCAL_API_KEY_ENV]: ` ${LOCAL_KEY} ` })).toBe(LOCAL_KEY);
  });

  it("is undefined when QUERIT_API_KEY is missing or blank", () => {
    expect(resolveQueritApiKey({})).toBeUndefined();
    expect(resolveQueritApiKey({ [LOCAL_API_KEY_ENV]: "   " })).toBeUndefined();
  });
});

describe("request normalization", () => {
  it("builds the stable default search request", () => {
    expect(buildSearchRequest("query")).toEqual({
      query: "query",
      count: 5,
      chunksPerDoc: 1,
      needContent: false,
    });
    expect(buildSearchRequest("query", 3).count).toBe(3);
  });

  it("normalizes and deduplicates requested URLs", () => {
    expect(normalizeRequestedUrls([
      "https://example.com/a",
      "https://example.com/a",
      "http://example.com/b",
    ])).toEqual(["https://example.com/a", "http://example.com/b"]);
  });

  it("rejects missing, unsafe, and overlarge URL batches", () => {
    expect(() => normalizeRequestedUrls([])).toThrow("at least one URL");
    expect(() => normalizeRequestedUrls(["file:///tmp/page"])).toThrow("HTTP(S)");
    expect(() => normalizeRequestedUrls(["https://user:pass@example.com/a"])).toThrow("credentials");
    const many = Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`);
    expect(() => normalizeRequestedUrls(many)).toThrow("at most 10");
  });
});

describe("tool handlers", () => {
  it("searches, trims the query, and returns cited untrusted output", async () => {
    const client: QueritClientLike = {
      search: vi.fn(async () => searchResponse({ query: "normalized" })),
      contents: vi.fn(),
    };
    const factory = vi.fn(() => client);
    const handlers = createToolHandlers({
      env: { [LOCAL_API_KEY_ENV]: PLUGIN_KEY },
      clientFactory: factory,
    });

    const result = await handlers.webSearch({ query: "  hello world  ", count: 3 });

    expect(factory).toHaveBeenCalledWith({ apiKey: PLUGIN_KEY });
    expect(client.search).toHaveBeenCalledWith({
      query: "hello world",
      count: 3,
      chunksPerDoc: 1,
      needContent: false,
    }, undefined);
    expect(result.isError).not.toBe(true);
    expect(resultText(result)).toContain("untrusted web data");
    expect(resultText(result)).toContain("URL: https://example.com/a");
  });

  it("fetches content with defaults and caps each page", async () => {
    const client: QueritClientLike = {
      search: vi.fn(),
      contents: vi.fn(async () => contentsResponse({
        results: [{ id: "1", url: "https://example.com/page", content: "x".repeat(10_000) }],
      })),
    };
    const handlers = createToolHandlers({
      env: { [LOCAL_API_KEY_ENV]: PLUGIN_KEY },
      clientFactory: () => client,
    });

    const result = await handlers.fetchContent({ urls: ["https://example.com/page"] });

    expect(client.contents).toHaveBeenCalledWith({
      urls: ["https://example.com/page"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
    }, undefined);
    expect(resultText(result)).toContain("Page content truncated by the Querit plugin");
    expect(resultText(result)).not.toContain("x".repeat(10_000));
  });

  it("returns actionable MCP errors when credentials are absent", async () => {
    const handlers = createToolHandlers({ env: {} });
    const result = await handlers.webSearch({ query: "q" });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("not configured");
    expect(resultText(result)).toContain(LOCAL_API_KEY_ENV);
  });

  it("redacts credentials and terminal controls from handler errors", async () => {
    const client: QueritClientLike = {
      search: vi.fn(async () => {
        throw new Error(`upstream exposed ${PLUGIN_KEY}\u001b[31m`);
      }),
      contents: vi.fn(),
    };
    const handlers = createToolHandlers({
      env: { [LOCAL_API_KEY_ENV]: PLUGIN_KEY },
      clientFactory: () => client,
    });

    const result = await handlers.webSearch({ query: "q" });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("upstream exposed [REDACTED]");
    expect(resultText(result)).not.toContain(PLUGIN_KEY);
    expect(resultText(result)).not.toContain("\u001b");
  });
});

describe("capPerPage", () => {
  it("preserves short responses and limits long content", () => {
    const short = contentsResponse();
    expect(capPerPage(short, MAX_PAGE_CONTENT_CHARS)).toBe(short);

    const long = contentsResponse({
      results: [{ url: "https://example.com", content: "🙂".repeat(5_000) }],
    });
    const capped = capPerPage(long, MAX_PAGE_CONTENT_CHARS);
    expect(capped.results[0]!.content.length).toBeLessThanOrEqual(MAX_PAGE_CONTENT_CHARS);
    expect(capped.results[0]!.content).toContain("Page content truncated");
  });
});
