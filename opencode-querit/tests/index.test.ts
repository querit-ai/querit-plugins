import { describe, expect, it, vi } from "vitest";
import type { ToolContext, ToolDefinition } from "@opencode-ai/plugin";
import {
  QueritPlugin,
  buildSearchRequest,
  normalizeRequestedUrls,
  type QueritClientLike,
  type QueritPluginOptions,
} from "../src/index.js";
import { resolveConfig } from "../src/config.js";
import type { QueritContentsResponse, QueritSearchResponse } from "../src/client.js";

const TEST_KEY = "sk-test-secret-key-123";

const context = {
  sessionID: "s1",
  messageID: "m1",
  agent: "build",
  directory: "/tmp/project",
  worktree: "/tmp/project",
  abort: new AbortController().signal,
  metadata: () => undefined,
  ask: () => undefined,
} as unknown as ToolContext;

function searchResponse(overrides: Partial<QueritSearchResponse> = {}): QueritSearchResponse {
  return {
    searchId: "42",
    query: "test",
    results: [
      { title: "Result A", url: "https://example.com/a", snippet: "snippet A", sentences: [] },
    ],
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

function pluginOptions(client: QueritClientLike): QueritPluginOptions {
  return { apiKey: TEST_KEY, clientFactory: () => client };
}

async function tools(client: QueritClientLike, options: QueritPluginOptions = pluginOptions(client)) {
  const hooks = await QueritPlugin({} as never, options as Record<string, unknown>);
  return hooks.tool as { web_search: ToolDefinition; web_fetch: ToolDefinition };
}

describe("buildSearchRequest", () => {
  it("applies defaults from the resolved config", () => {
    const config = resolveConfig({ timeRange: "m3", countries: ["japan"], includeContent: true }, {});
    const request = buildSearchRequest(config, "query");
    expect(request).toEqual({
      query: "query",
      count: 5,
      chunksPerDoc: 1,
      needContent: true,
      filters: {
        timeRange: { date: "m3" },
        geo: { countries: { include: ["japan"] } },
      },
    });
  });

  it("lets a per-call count override the default", () => {
    const config = resolveConfig({ count: 10 }, {});
    expect(buildSearchRequest(config, "query", 3).count).toBe(3);
    expect(buildSearchRequest(config, "query").count).toBe(10);
  });

  it("builds site include/exclude filters", () => {
    const config = resolveConfig({ includeDomains: ["github.com"], excludeDomains: ["pinterest.com"] }, {});
    expect(buildSearchRequest(config, "query").filters?.sites).toEqual({
      include: ["github.com"],
      exclude: ["pinterest.com"],
    });
  });
});

describe("normalizeRequestedUrls", () => {
  it("merges url and urls, deduplicating normalized forms", () => {
    const urls = normalizeRequestedUrls("https://example.com/a", ["https://example.com/a", "http://example.com/b"]);
    expect(urls).toEqual(["https://example.com/a", "http://example.com/b"]);
  });

  it("requires at least one URL", () => {
    expect(() => normalizeRequestedUrls(undefined, [])).toThrow("url or urls");
  });

  it("rejects unsupported protocols and embedded credentials", () => {
    expect(() => normalizeRequestedUrls("ftp://example.com/a")).toThrow("protocol");
    expect(() => normalizeRequestedUrls("https://user:pass@example.com/a")).toThrow("credentials");
  });

  it("caps at 10 unique URLs", () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`);
    expect(() => normalizeRequestedUrls(undefined, many)).toThrow("10");
  });
});

describe("web_search tool", () => {
  it("searches through the Querit client and renders formatted output", async () => {
    const client: QueritClientLike = {
      search: vi.fn(async (_request, _signal) => searchResponse({ searchId: "99", query: "queried" })),
      contents: vi.fn(),
    };
    const { web_search } = await tools(client);
    const result = await web_search.execute({ query: "  hello world  ", count: 3 }, context);

    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "hello world", count: 3 }),
      context.abort,
    );
    const parsed = result as { title: string; output: string; metadata: Record<string, unknown> };
    expect(parsed.title).toBe("Querit Search");
    expect(parsed.output).toContain("# Querit search results for: queried");
    expect(parsed.output).toContain("untrusted web data");
    expect(parsed.metadata).toEqual({
      query: "hello world",
      resultCount: 1,
      searchId: "99",
      sources: [{ title: "Result A", url: "https://example.com/a" }],
    });
  });

  it("fails clearly when no API key is configured", async () => {
    const client: QueritClientLike = { search: vi.fn(), contents: vi.fn() };
    const { web_search } = await tools(client, {});
    await expect(web_search.execute({ query: "q" }, context)).rejects.toThrow("QUERIT_API_KEY");
  });

  it("rejects an empty query", async () => {
    const { web_search } = await tools({ search: vi.fn(), contents: vi.fn() });
    await expect(web_search.execute({ query: "   " }, context)).rejects.toThrow("empty");
  });
});

describe("web_fetch tool", () => {
  it("fetches contents and reports per-page truncation metadata", async () => {
    const client: QueritClientLike = {
      search: vi.fn(),
      contents: vi.fn(async (_request, _signal) =>
        contentsResponse({ results: [{ id: "1", url: "https://example.com/page", content: "x".repeat(10_000) }] })),
    };
    const { web_fetch } = await tools(client, pluginOptions(client));

    const result = await web_fetch.execute(
      { url: "https://example.com/page", format: "text", crawl_timeout: 20, include_metadata: false },
      context,
    );

    expect(client.contents).toHaveBeenCalledWith(
      expect.objectContaining({ urls: ["https://example.com/page"], format: "text", crawlTimeout: 20, extrasMeta: false }),
      context.abort,
    );
    const parsed = result as { title: string; output: string; metadata: Record<string, unknown> };
    expect(parsed.title).toBe("Querit Fetch");
    expect(parsed.output).toContain("Requested: 1 | Returned: 1 | Successful: 1");
    expect(parsed.metadata.truncated).toBe(true);
    expect(parsed.output).not.toContain("x".repeat(10_000));
  });

  it("uses configured defaults for format and crawl timeout", async () => {
    const client: QueritClientLike = {
      search: vi.fn(),
      contents: vi.fn(async () => contentsResponse()),
    };
    const options = pluginOptions(client);
    options.fetchFormat = "markdown";
    options.fetchCrawlTimeout = 15;
    const { web_fetch } = await tools(client, options);

    await web_fetch.execute({ url: "https://example.com/page" }, context);
    expect(client.contents).toHaveBeenCalledWith(
      expect.objectContaining({ format: "markdown", crawlTimeout: 15, extrasMeta: true }),
      context.abort,
    );
  });

  it("fails clearly when no API key is configured", async () => {
    const client: QueritClientLike = { search: vi.fn(), contents: vi.fn() };
    const { web_fetch } = await tools(client, {});
    await expect(web_fetch.execute({ url: "https://example.com/page" }, context)).rejects.toThrow("QUERIT_API_KEY");
  });
});
