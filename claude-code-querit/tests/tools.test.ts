import { describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { QueritApiError, type QueritContentsResponse, type QueritSearchResponse } from "../src/client.js";
import { LOCAL_API_KEY_ENV, resolveQueritApiKey } from "../src/config.js";
import {
  MAX_PAGE_CONTENT_CHARS,
  buildSearchRequest,
  capPerPage,
  createToolHandlers,
  normalizeRequestedUrls,
  type FetchContentInput,
  type QueritClientLike,
  type WebSearchInput,
} from "../src/tools.js";

const PLUGIN_KEY = "plugin-key-placeholder";
const LOCAL_KEY = "local-key-placeholder";

function searchResponse(overrides: Partial<QueritSearchResponse> = {}): QueritSearchResponse {
  return {
    searchId: "42",
    query: "test",
    results: [{ title: "Result", url: "https://example.com/a", snippet: "snippet", sentences: [], highlights: [] }],
    ...overrides,
  };
}

function contentsResponse(overrides: Partial<QueritContentsResponse> = {}): QueritContentsResponse {
  return {
    searchId: "7",
    results: [{ id: "1", url: "https://example.com/page", content: "page body", highlights: [] }],
    statuses: [{ id: "1", status: "success" }],
    ...overrides,
  };
}

function resultText(result: CallToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") throw new Error("Expected text tool content.");
  return first.text;
}

function handlersWith(client: QueritClientLike) {
  const factory = vi.fn(() => client);
  const handlers = createToolHandlers({
    env: { [LOCAL_API_KEY_ENV]: PLUGIN_KEY },
    clientFactory: factory,
  });
  return { handlers, factory };
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
  it("builds a minimal search request by default and sends a count only when asked", () => {
    expect(buildSearchRequest({ query: "query" })).toEqual({ query: "query" });
    expect(buildSearchRequest({ query: "query", count: 100 })).toEqual({ query: "query", count: 100 });
  });

  it("maps highlights, body text, ranking, and vertical onto the API request", () => {
    expect(buildSearchRequest({ query: "query", highlights: true })).toEqual({
      query: "query",
      highlights: { query: "query" },
    });
    expect(buildSearchRequest({ query: "query", highlight_max_chars: 500 })).toEqual({
      query: "query",
      highlights: { query: "query", maxCharacters: 500 },
    });
    expect(buildSearchRequest({
      query: "query",
      highlights: true,
      highlight_query: "focus",
      highlight_max_chars: 300,
      need_content: true,
      max_chars: 2_000,
      need_markdown: true,
      rank: "freshness",
      vertical: "finance",
    })).toEqual({
      query: "query",
      highlights: { query: "focus", maxCharacters: 300 },
      needContent: true,
      contentMaxChars: 2_000,
      needMarkdown: true,
      rank: { preference: "freshness" },
      filters: { vertical: "finance" },
    });
  });

  it("withholds rank for the code vertical, which rejects it", () => {
    expect(buildSearchRequest({ query: "query", rank: "relevance", vertical: "code" })).toEqual({
      query: "query",
      filters: { vertical: "code" },
    });
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
    const { handlers, factory } = handlersWith(client);

    const result = await handlers.webSearch({ query: "  hello world  ", count: 3 });

    expect(factory).toHaveBeenCalledWith({ apiKey: PLUGIN_KEY });
    expect(client.search).toHaveBeenCalledWith({ query: "hello world", count: 3 }, undefined);
    expect(result.isError).not.toBe(true);
    expect(resultText(result)).toContain("untrusted web data");
    expect(resultText(result)).toContain("URL: https://example.com/a");
  });

  it("omits count when the caller did not choose one", async () => {
    const client: QueritClientLike = { search: vi.fn(async () => searchResponse()), contents: vi.fn() };
    const { handlers } = handlersWith(client);

    await handlers.webSearch({ query: "hello world" });

    expect(client.search).toHaveBeenCalledWith({ query: "hello world" }, undefined);
  });

  it("forwards the new search options and reports a rank withheld for the code vertical", async () => {
    const client: QueritClientLike = {
      search: vi.fn(async () => searchResponse({
        results: [{ title: "Result", url: "https://example.com/a", snippet: "snippet", sentences: [], highlights: ["focused text"] }],
      })),
      contents: vi.fn(),
    };
    const { handlers } = handlersWith(client);

    const result = await handlers.webSearch({
      query: "rate limiter",
      highlights: true,
      highlight_query: " semaphore ",
      rank: "freshness",
      vertical: "code",
    });
    const text = resultText(result);

    expect(client.search).toHaveBeenCalledWith({
      query: "rate limiter",
      highlights: { query: "semaphore" },
      filters: { vertical: "code" },
    }, undefined);
    expect(text).toContain("rank preference was not applied because Querit rejects rank for the code vertical");
    expect(text).toContain("- focused text");
  });

  it("sends rank alongside the finance vertical and says nothing about withholding", async () => {
    const client: QueritClientLike = { search: vi.fn(async () => searchResponse()), contents: vi.fn() };
    const { handlers } = handlersWith(client);

    const result = await handlers.webSearch({ query: "fed rate", rank: "freshness", vertical: "finance" });

    expect(client.search).toHaveBeenCalledWith({
      query: "fed rate",
      rank: { preference: "freshness" },
      filters: { vertical: "finance" },
    }, undefined);
    expect(resultText(result)).not.toContain("rank preference was not applied");
  });

  it("accepts the documented bounds", async () => {
    const client: QueritClientLike = { search: vi.fn(async () => searchResponse()), contents: vi.fn() };
    const { handlers } = handlersWith(client);

    const result = await handlers.webSearch({
      query: "bounds",
      count: 100,
      highlights: true,
      highlight_max_chars: 8_000,
      need_content: true,
      max_chars: 1_000_000,
      need_markdown: true,
    });

    expect(result.isError).not.toBe(true);
    expect(client.search).toHaveBeenCalledWith({
      query: "bounds",
      count: 100,
      highlights: { query: "bounds", maxCharacters: 8_000 },
      needContent: true,
      contentMaxChars: 1_000_000,
      needMarkdown: true,
    }, undefined);
  });

  it("shows a reported cost next to the search ID and nothing when cost is unavailable", async () => {
    const search = vi.fn(async () => searchResponse({ cost: { currency: "USD", total: 0.000123 } }));
    const { handlers } = handlersWith({ search, contents: vi.fn() });
    expect(resultText(await handlers.webSearch({ query: "q" }))).toContain("Search ID: 42 | Cost: USD 0.000123");

    search.mockImplementation(async () => searchResponse({ cost: { currency: "USD", total: 0 } }));
    expect(resultText(await handlers.webSearch({ query: "q" }))).toContain("| Cost: USD 0.000000");

    search.mockImplementation(async () => searchResponse());
    expect(resultText(await handlers.webSearch({ query: "q" }))).not.toContain("Cost:");
  });

  it("rejects invalid search options before any request", async () => {
    const client: QueritClientLike = { search: vi.fn(async () => searchResponse()), contents: vi.fn() };
    const { handlers } = handlersWith(client);
    const invalid: WebSearchInput[] = [
      { query: "q", count: 0 },
      { query: "q", count: 101 },
      { query: "q", count: 2.5 },
      { query: "q", max_chars: 500 },
      { query: "q", need_content: true, max_chars: 0 },
      { query: "q", need_content: true, max_chars: 1_000_001 },
      { query: "q", highlight_max_chars: 99 },
      { query: "q", highlight_max_chars: 8_001 },
      { query: "q", highlight_query: "   " },
      { query: "q", rank: "popular" as never },
      { query: "q", vertical: "news" as never },
      { query: "q", need_content: "yes" as never },
    ];

    for (const input of invalid) {
      const result = await handlers.webSearch(input);
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("Querit tool error:");
    }
    expect(client.search).not.toHaveBeenCalled();

    const messages = async (input: WebSearchInput) => resultText(await handlers.webSearch(input));
    expect(await messages({ query: "q", count: 101 })).toContain("count must be an integer between 1 and 100");
    expect(await messages({ query: "q", max_chars: 500 })).toContain("max_chars limits the body text, so it requires need_content: true");
    expect(await messages({ query: "q", rank: "popular" as never })).toContain("rank must be one of: relevance, freshness");
    expect(await messages({ query: "q", vertical: "news" as never })).toContain("vertical must be one of: code, finance");
  });

  it("fetches content with defaults and caps each page", async () => {
    const client: QueritClientLike = {
      search: vi.fn(),
      contents: vi.fn(async () => contentsResponse({
        results: [{ id: "1", url: "https://example.com/page", content: "x".repeat(10_000), highlights: [] }],
      })),
    };
    const { handlers } = handlersWith(client);

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

  it("fetches with a length limit or highlights and then leaves the capping to Querit", async () => {
    const client: QueritClientLike = {
      search: vi.fn(),
      contents: vi.fn(async () => contentsResponse({
        cost: { currency: "USD", total: 0.02 },
        results: [{
          id: "1",
          url: "https://example.com/page",
          content: "x".repeat(10_000),
          highlights: ["the \u001b[31mrelease date\u001b[0m"],
        }],
      })),
    };
    const { handlers } = handlersWith(client);

    const result = await handlers.fetchContent({
      urls: ["https://example.com/page"],
      max_chars: 50_000,
      highlight_query: " release notes ",
      highlight_max_chars: 2_000,
    });
    const text = resultText(result);

    expect(client.contents).toHaveBeenCalledWith({
      urls: ["https://example.com/page"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
      contentMaxChars: 50_000,
      highlights: { query: "release notes", maxCharacters: 2_000 },
    }, undefined);
    expect(text).toContain("x".repeat(10_000));
    expect(text).not.toContain("Page content truncated");
    expect(text).toContain("Search ID: 7 | Cost: USD 0.020000");
    expect(text).toContain("- the release date");
    expect(text).not.toContain("\u001b");
  });

  it("rejects invalid fetch options before any request", async () => {
    const client: QueritClientLike = { search: vi.fn(), contents: vi.fn(async () => contentsResponse()) };
    const { handlers } = handlersWith(client);
    const invalid: FetchContentInput[] = [
      { urls: ["https://example.com"], max_chars: 0 },
      { urls: ["https://example.com"], max_chars: 1_000_001 },
      { urls: ["https://example.com"], highlight_max_chars: 99 },
      { urls: ["https://example.com"], highlight_max_chars: 8_001 },
      { urls: ["https://example.com"], highlight_query: "  " },
    ];

    for (const input of invalid) {
      const result = await handlers.fetchContent(input);
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("Querit tool error:");
    }
    expect(client.contents).not.toHaveBeenCalled();

    const result = await handlers.fetchContent({ urls: ["https://example.com"], max_chars: 0 });
    expect(resultText(result)).toContain("max_chars must be an integer between 1 and 1000000");
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
    const { handlers } = handlersWith(client);

    const result = await handlers.webSearch({ query: "q" });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("upstream exposed [REDACTED]");
    expect(resultText(result)).not.toContain(PLUGIN_KEY);
    expect(resultText(result)).not.toContain("\u001b");
  });

  it("carries search_id from API failures into the tool error", async () => {
    const client: QueritClientLike = {
      search: vi.fn(async () => {
        throw new QueritApiError("Querit request failed after 3 attempts: transient 503 [search_id: 5]", {
          status: 503,
          searchId: "5",
          attempts: 3,
        });
      }),
      contents: vi.fn(),
    };
    const { handlers } = handlersWith(client);

    const result = await handlers.webSearch({ query: "q" });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe("Querit tool error: Querit request failed after 3 attempts: transient 503 [search_id: 5]");
  });
});

describe("capPerPage", () => {
  it("preserves short responses and limits long content", () => {
    const short = contentsResponse();
    expect(capPerPage(short, MAX_PAGE_CONTENT_CHARS)).toBe(short);

    const long = contentsResponse({
      results: [{ url: "https://example.com", content: "🙂".repeat(5_000), highlights: [] }],
    });
    const capped = capPerPage(long, MAX_PAGE_CONTENT_CHARS);
    expect(capped.results[0]!.content.length).toBeLessThanOrEqual(MAX_PAGE_CONTENT_CHARS);
    expect(capped.results[0]!.content).toContain("Page content truncated");
  });
});
