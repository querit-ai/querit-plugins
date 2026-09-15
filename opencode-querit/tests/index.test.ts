import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "@opencode/plugin";
import {
  QueritPlugin,
  QUERIT_PROVIDER_ID,
  buildSearchRequest,
  createQueritFetchTool,
  createQueritWebSearchProvider,
  normalizeRequestedUrls,
  toWebSearchResults,
  type QueritClientLike,
  type QueritPluginOptions,
  type QueritWebSearchProvider,
} from "../src/index.js";
import { resolveConfig } from "../src/config.js";
import type { QueritContentsResponse, QueritSearchResponse } from "../src/client.js";

const TEST_KEY = "sk-test-secret-key-123";

function searchResponse(overrides: Partial<QueritSearchResponse> = {}): QueritSearchResponse {
  return {
    searchId: "42",
    query: "test",
    results: [
      {
        title: "Result A",
        url: "https://example.com/a",
        snippet: "snippet A",
        pageAge: "2026-01-02",
        sentences: ["sentence one."],
      },
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

function pluginOptions(client: QueritClientLike, extra: QueritPluginOptions = {}): QueritPluginOptions {
  return { apiKey: TEST_KEY, clientFactory: () => client, ...extra };
}

function client(): QueritClientLike {
  return { search: vi.fn(), contents: vi.fn() };
}

const toolContext = { progress: vi.fn(async () => undefined) };

// A developer machine may export QUERIT_API_KEY; keep "no key" cases hermetic.
afterEach(() => {
  vi.unstubAllEnvs();
});

/** Capture provider/tool registrations performed by the plugin's setup. */
function harness(options: Record<string, unknown> = {}) {
  const providers: QueritWebSearchProvider[] = [];
  const defaultSets: Array<string | false> = [];
  const tools: Array<ReturnType<typeof createQueritFetchTool>> = [];
  const disposed: string[] = [];

  const registration = (label: string) => ({ dispose: vi.fn(async () => void disposed.push(label)) });

  const context = {
    options,
    websearch: {
      transform: vi.fn(async (callback: (editor: unknown) => void) => {
        callback({
          add: (provider: QueritWebSearchProvider) => providers.push(provider),
          default: { get: () => undefined, set: (selection: string | false) => defaultSets.push(selection) },
        });
        return registration("websearch");
      }),
    },
    tool: {
      transform: vi.fn(async (callback: (editor: unknown) => void) => {
        callback({
          add: (tool: ReturnType<typeof createQueritFetchTool>) => tools.push(tool),
          list: () => tools,
          get: () => undefined,
          namespace: () => undefined,
          update: () => undefined,
          remove: () => undefined,
        });
        return registration("tool");
      }),
    },
  } as unknown as Parameters<Plugin.Plugin["setup"]>[0];

  return { context, providers, defaultSets, tools, disposed };
}

describe("QueritPlugin setup", () => {
  it("registers the Querit websearch provider and the web_fetch tool", async () => {
    const h = harness({ apiKey: TEST_KEY });
    const cleanup = await QueritPlugin.setup(h.context);
    expect(h.providers.map((provider) => provider.id)).toEqual([QUERIT_PROVIDER_ID]);
    expect(h.providers[0]?.name).toBe("Querit");
    expect(h.tools.map((tool) => tool.name)).toEqual(["web_fetch"]);
    expect(h.defaultSets).toEqual([]);

    await cleanup?.();
    expect(h.disposed.sort()).toEqual(["tool", "websearch"]);
  });

  it("sets Querit as the default provider only when setDefault is true", async () => {
    const h = harness({ apiKey: TEST_KEY, setDefault: true });
    await QueritPlugin.setup(h.context);
    expect(h.defaultSets).toEqual([QUERIT_PROVIDER_ID]);
  });

  it("fails plugin load on invalid options", async () => {
    const h = harness({ apiKey: TEST_KEY, count: 99 });
    await expect(QueritPlugin.setup(h.context)).rejects.toThrow("count must be an integer");
  });
});

describe("websearch provider", () => {
  it("searches through the Querit client and maps results", async () => {
    const mock = client();
    vi.mocked(mock.search).mockResolvedValue(searchResponse({ searchId: "99", query: "queried" }));
    const provider = createQueritWebSearchProvider(pluginOptions(mock));

    const signal = AbortSignal.timeout(5_000);
    const results = await provider.execute({ query: "  hello world  " }, { signal });

    expect(mock.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "hello world", count: 5 }),
      signal,
    );
    expect(results).toEqual([
      {
        url: "https://example.com/a",
        title: "Result A",
        content: "snippet A sentence one.",
        time: { published: Date.parse("2026-01-02") },
      },
    ]);
  });

  it("omits unparsable publish dates and empty content", async () => {
    const results = toWebSearchResults(
      { query: "q", results: [{ title: "B", url: "https://b.example", snippet: "", sentences: [], pageAge: "2 days ago" }] },
      resolveConfig({}, {}),
    );
    expect(results).toEqual([{ url: "https://b.example", title: "B", time: {} }]);
  });

  it("fails clearly when no API key is configured", async () => {
    vi.stubEnv("QUERIT_API_KEY", "");
    const provider = createQueritWebSearchProvider({});
    await expect(provider.execute({ query: "q" }, { signal: AbortSignal.abort() })).rejects.toThrow("QUERIT_API_KEY");
  });

  it("rejects an empty query", async () => {
    const provider = createQueritWebSearchProvider(pluginOptions(client()));
    await expect(provider.execute({ query: "   " }, { signal: AbortSignal.abort() })).rejects.toThrow("empty");
  });
});

describe("web_fetch tool", () => {
  it("fetches contents and reports truncation metadata", async () => {
    const mock = client();
    vi.mocked(mock.contents).mockResolvedValue(
      contentsResponse({ results: [{ id: "1", url: "https://example.com/page", content: "x".repeat(10_000) }] }),
    );
    const tool = createQueritFetchTool(pluginOptions(mock));

    const result = await tool.execute(
      { url: "https://example.com/page", format: "text", crawl_timeout: 20, include_metadata: false },
      toolContext,
    );

    expect(mock.contents).toHaveBeenCalledWith(
      expect.objectContaining({ urls: ["https://example.com/page"], format: "text", crawlTimeout: 20, extrasMeta: false }),
    );
    expect(result.content).toContain("Requested: 1 | Returned: 1 | Successful: 1");
    expect(result.metadata).toMatchObject({ resultCount: 1, truncated: true });
    expect(result.content).not.toContain("x".repeat(10_000));
  });

  it("uses configured defaults for format and crawl timeout", async () => {
    const mock = client();
    vi.mocked(mock.contents).mockResolvedValue(contentsResponse());
    const tool = createQueritFetchTool(pluginOptions(mock, { fetchFormat: "markdown", fetchCrawlTimeout: 15 }));

    await tool.execute({ url: "https://example.com/page" }, toolContext);
    expect(mock.contents).toHaveBeenCalledWith(
      expect.objectContaining({ format: "markdown", crawlTimeout: 15, extrasMeta: true }),
    );
  });

  it("fails clearly when no API key is configured", async () => {
    vi.stubEnv("QUERIT_API_KEY", "");
    const tool = createQueritFetchTool({});
    await expect(tool.execute({ url: "https://example.com/page" }, toolContext)).rejects.toThrow("QUERIT_API_KEY");
  });
});

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
