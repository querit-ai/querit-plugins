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
import {
  QUERIT_COUNT_LIMIT,
  QUERIT_HIGHLIGHT_MAX_CHARACTERS,
  QUERIT_HIGHLIGHT_MIN_CHARACTERS,
  QUERIT_URLS_LIMIT,
  type QueritContentsResponse,
  type QueritSearchResponse,
} from "../src/client.js";
import { resolveConfig } from "../src/config.js";

const TEST_KEY = "sk-test-secret-key-123";

type SearchResult = QueritSearchResponse["results"][number];

function searchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: "Result A",
    url: "https://example.com/a",
    snippet: "snippet A",
    pageAge: "2026-01-02",
    sentences: ["sentence one."],
    highlights: [],
    ...overrides,
  };
}

function searchResponse(overrides: Partial<QueritSearchResponse> = {}): QueritSearchResponse {
  return { searchId: "42", query: "test", results: [searchResult()], ...overrides };
}

function contentsResponse(overrides: Partial<QueritContentsResponse> = {}): QueritContentsResponse {
  return {
    searchId: "7",
    results: [{ id: "1", url: "https://example.com/page", content: "page body", highlights: [] }],
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

/** The host hands a tool its abort signal and a progress reporter. */
function toolContext(signal: AbortSignal = new AbortController().signal) {
  return { signal, progress: vi.fn(async () => undefined) };
}

// A developer machine may export QUERIT_API_KEY or sit in any time zone; keep those cases hermetic.
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
    const h = harness({ apiKey: TEST_KEY, count: QUERIT_COUNT_LIMIT + 1 });
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

    expect(mock.search).toHaveBeenCalledWith({ query: "hello world" }, signal);
    expect(results).toEqual([{
      url: "https://example.com/a",
      title: "Result A",
      content: "snippet A sentence one.",
      time: { published: Date.parse("2026-01-02") },
    }]);
  });

  it("puts highlights before the body and prefers Markdown when the API returns them", () => {
    const results = toWebSearchResults(
      {
        query: "q",
        results: [searchResult({
          snippet: "plain snippet",
          snippetMarkdown: ["**markdown", "snippet**"],
          highlights: ["first fragment", "second fragment"],
          sentences: ["plain sentence."],
          contentMarkdown: "# body",
        })],
      },
      resolveConfig({}),
    );

    expect(results[0]?.content).toBe("**markdown snippet** first fragment second fragment # body");
  });

  it.each([
    ["America/New_York", 240],
    ["Asia/Kolkata", -330],
    ["UTC", 0],
  ] as const)("reads a zone-less page_age as UTC under TZ=%s", (zone, offset) => {
    vi.stubEnv("TZ", zone);
    // Proves the zone really changed, so the assertion below cannot pass by accident.
    expect(new Date(Date.parse("2026-07-14T09:00:00Z")).getTimezoneOffset()).toBe(offset);

    const results = toWebSearchResults(
      { query: "q", results: [searchResult({ pageAge: "2026-07-14 09:00:00" })] },
      resolveConfig({}),
    );

    // `Date.parse` would place a zone-less time in the machine's zone; Querit reports it in UTC+0.
    expect(results[0]?.time).toEqual({ published: Date.parse("2026-07-14T09:00:00Z") });
  });

  it("keeps an explicit zone and rejects dates that do not exist", () => {
    const results = toWebSearchResults(
      {
        query: "q",
        results: [
          searchResult({ url: "https://a.example", pageAge: "2026-07-14T09:00:00+05:30" }),
          searchResult({ url: "https://b.example", pageAge: "2026-02-30 09:00:00" }),
          searchResult({ url: "https://c.example", pageAge: "July 14, 2026" }),
        ],
      },
      resolveConfig({}),
    );

    expect(results.map((result) => result.time)).toEqual([
      { published: Date.parse("2026-07-14T09:00:00+05:30") },
      {},
      {},
    ]);
  });

  it("omits unparsable publish dates and empty content", () => {
    const results = toWebSearchResults(
      { query: "q", results: [searchResult({ title: "B", url: "https://b.example", snippet: "", sentences: [], pageAge: "2 days ago" })] },
      resolveConfig({}),
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
      contentsResponse({ results: [{ id: "1", url: "https://example.com/page", content: "x".repeat(10_000), highlights: [] }] }),
    );
    const tool = createQueritFetchTool(pluginOptions(mock));

    const result = await tool.execute(
      { url: "https://example.com/page", format: "text", crawl_timeout: 20, include_metadata: false },
      toolContext(),
    );

    expect(mock.contents).toHaveBeenCalledWith(
      { urls: ["https://example.com/page"], format: "text", crawlTimeout: 20, extrasMeta: false },
      expect.any(AbortSignal),
    );
    expect(result.content).toContain("Requested: 1 | Returned: 1 | Successful: 1");
    expect(result.metadata).toMatchObject({ resultCount: 1, truncated: true, searchId: "7" });
    expect(result.content).not.toContain("x".repeat(10_000));
  });

  it("hands the host's abort signal to the client", async () => {
    const mock = client();
    vi.mocked(mock.contents).mockResolvedValue(contentsResponse());
    const signal = new AbortController().signal;

    await createQueritFetchTool(pluginOptions(mock)).execute({ url: "https://example.com/page" }, toolContext(signal));

    expect(mock.contents).toHaveBeenCalledWith(expect.anything(), signal);
  });

  it("falls back to the configured fetchFormat and crawl timeout", async () => {
    const mock = client();
    vi.mocked(mock.contents).mockResolvedValue(contentsResponse());
    const tool = createQueritFetchTool(pluginOptions(mock, { fetchFormat: "html", fetchCrawlTimeout: 15 }));

    await tool.execute({ url: "https://example.com/page" }, toolContext());

    expect(mock.contents).toHaveBeenCalledWith({ urls: ["https://example.com/page"], format: "html", crawlTimeout: 15, extrasMeta: true }, expect.any(AbortSignal));
  });

  it("sends a content limit and highlights only when the call asks for them", async () => {
    const mock = client();
    vi.mocked(mock.contents).mockResolvedValue(contentsResponse());

    const tool = createQueritFetchTool(pluginOptions(mock));
    await tool.execute(
      { url: "https://example.com/page", max_chars: 2_000, highlight_query: "pricing", highlight_max_chars: 500 },
      toolContext(),
    );
    await tool.execute({ url: "https://example.com/page", highlight_max_chars: 800 }, toolContext());
    await tool.execute({ url: "https://example.com/page" }, toolContext());

    const requests = vi.mocked(mock.contents).mock.calls.map(([request]) => request);
    expect(requests[0]).toMatchObject({ contentMaxChars: 2_000, highlights: { query: "pricing", maxCharacters: 500 } });
    expect(requests[1]).toMatchObject({ highlights: { maxCharacters: 800 } });
    expect(requests[1]).not.toHaveProperty("contentMaxChars");
    expect(requests[2]).not.toHaveProperty("contentMaxChars");
    expect(requests[2]).not.toHaveProperty("highlights");
  });

  it("reports a cost only when Querit sent one", async () => {
    const mock = client();
    const tool = createQueritFetchTool(pluginOptions(mock));

    vi.mocked(mock.contents).mockResolvedValue(contentsResponse({ cost: { currency: "USD", total: 0.001 } }));
    const charged = await tool.execute({ url: "https://example.com/page" }, toolContext());
    expect(charged.metadata).toMatchObject({ cost: { currency: "USD", total: 0.001 } });
    expect(charged.content).toContain("Cost: USD 0.001000");

    vi.mocked(mock.contents).mockResolvedValue(contentsResponse());
    const unreported = await tool.execute({ url: "https://example.com/page" }, toolContext());
    expect(unreported.metadata).not.toHaveProperty("cost");
    expect(unreported.content).not.toContain("Cost");
  });

  it("renders highlights Querit selected from the page", async () => {
    const mock = client();
    vi.mocked(mock.contents).mockResolvedValue(contentsResponse({
      results: [{ id: "1", url: "https://example.com/page", content: "page body", highlights: ["the decisive passage"] }],
    }));

    const result = await createQueritFetchTool(pluginOptions(mock)).execute(
      { url: "https://example.com/page", highlight_query: "decisive" },
      toolContext(),
    );

    expect(result.content).toContain("Highlights:\n- the decisive passage");
  });

  it("fails clearly when no API key is configured", async () => {
    vi.stubEnv("QUERIT_API_KEY", "");
    const tool = createQueritFetchTool({});
    await expect(tool.execute({ url: "https://example.com/page" }, toolContext())).rejects.toThrow("QUERIT_API_KEY");
  });

  it("validates arguments against the documented parameter bounds", () => {
    const input = createQueritFetchTool(pluginOptions(client())).input;
    /** Fields with a validation issue; empty when the arguments are valid. */
    const invalidFields = (args: unknown) => {
      const parsed = input.safeParse(args);
      return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
    };
    const tooManyUrls = Array.from({ length: QUERIT_URLS_LIMIT + 1 }, (_, i) => `https://example.com/${i}`);

    expect(invalidFields({
      url: "https://example.com/page",
      format: "markdown",
      crawl_timeout: 60,
      max_chars: 1_000_000,
      highlight_max_chars: QUERIT_HIGHLIGHT_MAX_CHARACTERS,
    })).toEqual([]);
    expect(invalidFields({ urls: tooManyUrls })).toContain("urls");
    expect(invalidFields({ url: "https://example.com", format: "json" })).toContain("format");
    expect(invalidFields({ url: "https://example.com", crawl_timeout: 0 })).toContain("crawl_timeout");
    expect(invalidFields({ url: "https://example.com", max_chars: 0 })).toContain("max_chars");
    expect(invalidFields({ url: "https://example.com", highlight_max_chars: QUERIT_HIGHLIGHT_MIN_CHARACTERS - 1 })).toContain("highlight_max_chars");
  });

  it("describes its input as JSON Schema through the hook the host calls on plugin schemas", () => {
    interface StandardJsonSchema {
      "~standard": { jsonSchema: { input: (options: { target: string }) => unknown } };
    }
    const input = createQueritFetchTool(pluginOptions(client())).input as unknown as StandardJsonSchema;
    const schema = input["~standard"].jsonSchema.input({ target: "draft-2020-12" }) as {
      type: string;
      properties: Record<string, Record<string, unknown>>;
    };

    expect(schema.type).toBe("object");
    expect(schema.properties.format?.enum).toEqual(["text", "markdown", "html"]);
    expect(schema.properties.urls?.maxItems).toBe(QUERIT_URLS_LIMIT);
    expect(schema.properties.highlight_max_chars).toMatchObject({
      minimum: QUERIT_HIGHLIGHT_MIN_CHARACTERS,
      maximum: QUERIT_HIGHLIGHT_MAX_CHARACTERS,
    });
  });
});

describe("buildSearchRequest", () => {
  it("sends only what the user configured", () => {
    expect(buildSearchRequest(resolveConfig({}, {}), "query")).toEqual({ query: "query" });
  });

  it("applies configured filters and options", () => {
    const config = resolveConfig({
      count: 8,
      timeRange: "m3",
      countries: ["japan"],
      languages: ["russian"],
      vertical: "finance",
      rank: "relevance",
      highlights: true,
      includeContent: true,
      contentMaxChars: 2_000,
      needMarkdown: true,
    }, {});

    expect(buildSearchRequest(config, "query")).toEqual({
      query: "query",
      count: 8,
      highlights: true,
      needContent: true,
      contentMaxChars: 2_000,
      needMarkdown: true,
      rank: { preference: "relevance" },
      filters: {
        timeRange: { date: "m3" },
        geo: { countries: { include: ["japan"] } },
        languages: { include: ["russian"] },
        vertical: "finance",
      },
    });
  });

  it("builds site include/exclude filters", () => {
    const config = resolveConfig({ includeDomains: ["github.com"], excludeDomains: ["pinterest.com"] }, {});
    expect(buildSearchRequest(config, "query").filters?.sites).toEqual({
      include: ["github.com"],
      exclude: ["pinterest.com"],
    });
  });

  it("drops rank for the code vertical, which rejects it", () => {
    const request = buildSearchRequest(
      resolveConfig({ vertical: "code", rank: "freshness", resourceTags: ["github"] }, {}),
      "query",
    );

    expect(request).not.toHaveProperty("rank");
    expect(request.filters).toEqual({ vertical: "code", resourceTags: { include: ["github"] } });
  });

  it("sends chunksPerDoc only when it is configured", () => {
    expect(buildSearchRequest(resolveConfig({}, {}), "query")).not.toHaveProperty("chunksPerDoc");
    expect(buildSearchRequest(resolveConfig({ chunksPerDoc: 2 }, {}), "query").chunksPerDoc).toBe(2);
  });

  it("sends contentMaxChars only together with includeContent, the only case Querit reads it", () => {
    expect(buildSearchRequest(resolveConfig({ contentMaxChars: 2_000 }, {}), "query")).not.toHaveProperty("contentMaxChars");
    expect(buildSearchRequest(resolveConfig({ includeContent: true }, {}), "query")).toEqual({
      query: "query",
      needContent: true,
    });
    expect(
      buildSearchRequest(resolveConfig({ includeContent: true, contentMaxChars: 2_000 }, {}), "query").contentMaxChars,
    ).toBe(2_000);
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
    const many = Array.from({ length: QUERIT_URLS_LIMIT + 1 }, (_, i) => `https://example.com/${i}`);
    expect(() => normalizeRequestedUrls(undefined, many)).toThrow("at most 10 unique URLs");
  });
});
