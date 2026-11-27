import { describe, expect, it, vi } from "vitest";
import { QueritApiError } from "../src/client.js";
import {
  QueritFetchProvider,
  QueritSearchProvider,
  isTimeRange,
  normalizeDomains,
  type QueritClientLike,
  type QueritOperationEvent,
  type QueritProviderOptions,
} from "../src/provider.js";

function makeOptions(overrides: Partial<QueritProviderOptions> = {}): QueritProviderOptions {
  return {
    apiKey: "sk-test-key",
    baseURL: "https://api.querit.ai",
    timeoutMs: 70_000,
    countries: [],
    languages: [],
    includeDomains: [],
    excludeDomains: [],
    includeContent: false,
    highlights: false,
    needMarkdown: false,
    resourceTags: [],
    fetchFormat: "markdown",
    fetchCrawlTimeout: 10,
    fetchMaxChars: 8_000,
    ...overrides,
  };
}

function fakeClient(impl: Partial<QueritClientLike> = {}): QueritClientLike {
  return {
    search: vi.fn(async () => ({ query: "q", results: [] })),
    contents: vi.fn(async () => ({ results: [], statuses: [] })),
    ...impl,
  };
}

function webCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

describe("isTimeRange", () => {
  it.each(["d7", "w2", "m3", "y1", "d30", "2026-01-01to2026-02-01"])("accepts %s", (value) => {
    expect(isTimeRange(value)).toBe(true);
  });

  it.each(["", "d0", "7d", "2026-01-01", "2026-01-01-2026-02-01", "d7 extra"])("rejects %s", (value) => {
    expect(isTimeRange(value)).toBe(false);
  });
});

describe("normalizeDomains", () => {
  it("lowercases and strips schemes, ports, and paths", () => {
    expect(normalizeDomains(["GitHub.COM", "https://example.com/x?y=1", "example.org:8080/p"])).toEqual([
      "github.com",
      "example.com",
      "example.org",
    ]);
  });

  it("drops invalid entries and deduplicates", () => {
    expect(normalizeDomains(["a", "example.com", "EXAMPLE.com", "no dot here", ""])).toEqual(["example.com"]);
  });

  it("caps the list at 100 entries", () => {
    const values = Array.from({ length: 150 }, (_, index) => `site${index}.com`);
    expect(normalizeDomains(values)).toHaveLength(100);
  });
});

describe("QueritSearchProvider", () => {
  it("reports availability from local facts only", () => {
    expect(new QueritSearchProvider(() => makeOptions()).available()).toBe(true);

    expect(new QueritSearchProvider(() => makeOptions({ apiKey: undefined, resolveApiKey: async () => "k" })).available()).toBe(true);
    expect(new QueritSearchProvider(() => makeOptions({ apiKey: undefined })).available()).toBe(false);
    expect(new QueritSearchProvider(() => makeOptions({ baseURL: "not a url" })).available()).toBe(false);
    expect(new QueritSearchProvider(() => makeOptions({ timeRange: "yesterday" })).available()).toBe(false);
    expect(new QueritSearchProvider(() => makeOptions({ count: 100 })).available()).toBe(true);
    expect(new QueritSearchProvider(() => makeOptions({ count: 101 })).available()).toBe(false);
    expect(new QueritSearchProvider(() => makeOptions({ count: undefined })).available()).toBe(true);
  });

  it("names and describes itself for the provider picker", () => {
    const provider = new QueritSearchProvider(() => makeOptions());
    expect(provider.id).toBe("web-search-querit");
    expect(provider.title).toBe("Querit");
    expect(provider.description).toMatchObject({ en: expect.any(String), zh: expect.any(String) });
  });

  it("answers ready from configuration without touching the network", async () => {
    const literal = new QueritSearchProvider(() => makeOptions());
    expect(await literal.ready()).toBe(true);

    const remote = new QueritSearchProvider(() => makeOptions({ apiKey: undefined, apiKeyConfigured: async () => true }));
    expect(await remote.ready()).toBe(true);

    const unconfigured = new QueritSearchProvider(() => makeOptions({ apiKey: undefined, apiKeyConfigured: async () => false }));
    expect(await unconfigured.ready()).toBe(false);

    const unreadable = new QueritSearchProvider(() => makeOptions({
      apiKey: undefined,
      apiKeyConfigured: async () => { throw new Error("store offline"); },
    }));
    expect(await unreadable.ready()).toBe(false);

    const resolving = new QueritSearchProvider(() => makeOptions({ apiKey: undefined, resolveApiKey: async () => "k" }));
    expect(await resolving.ready()).toBe(true);
  });

  it("keeps the snippet for display and puts highlights, then body text, in the model summary", async () => {
    const client = fakeClient({
      search: vi.fn(async () => ({
        query: "q",
        results: [
          {
            title: "Page",
            url: "https://example.com/a",
            snippet: "intro\n  with   spaces",
            pageAge: "3d",
            sentences: ["fact one", "fact two"],
            highlights: ["the relevant bit"],
          },
          { title: "No age", url: "https://example.com/b", snippet: " ", sentences: [], highlights: [] },
          { title: "Long", url: "https://example.com/c", snippet: "x".repeat(1_000), sentences: [], highlights: [] },
        ],
      })),
    });
    const options = makeOptions();
    options.clientFactory = () => client;
    const provider = new QueritSearchProvider(() => options);

    const result = await provider.search({ query: "q" });
    expect(result.truncated).toBe(false);
    expect(result.content).toBeUndefined();
    expect(result.sources).toHaveLength(3);
    expect(result.sources[0]).toEqual({
      url: "https://example.com/a",
      title: "Page",
      snippet: "intro with spaces",
      summary: "the relevant bit\n- fact one\n- fact two",
      publishedAt: "3d",
    });
    expect(result.sources[1]).toEqual({ url: "https://example.com/b", title: "No age" });
    expect(result.sources[2]?.snippet?.length).toBe(512);
    expect(result.sources[2]?.summary).toBeUndefined();
  });

  it("prefers a Markdown body for the model summary", async () => {
    const client = fakeClient({
      search: vi.fn(async () => ({
        query: "q",
        results: [{ title: "Page", url: "https://example.com/a", snippet: "plain", sentences: ["plain body"], highlights: [], contentMarkdown: "# Body" }],
      })),
    });
    const options = makeOptions();
    options.clientFactory = () => client;

    const result = await new QueritSearchProvider(() => options).search({ query: "q" });
    expect(result.sources[0]).toMatchObject({ snippet: "plain", summary: "# Body" });
  });

  it("builds the request from the configured defaults", async () => {
    const client = fakeClient({ search: vi.fn(async () => ({ query: "q", results: [] })) });
    const options = makeOptions({
      count: 5,
      timeRange: "m3",
      countries: ["united states"],
      languages: ["english", "russian"],
      includeDomains: ["github.com"],
      excludeDomains: ["pinterest.com", "facebook.com"],
      includeContent: true,
      contentMaxChars: 1_500,
      highlights: true,
      needMarkdown: true,
      chunksPerDoc: 2,
      rank: "freshness",
    });
    options.clientFactory = () => client;

    await new QueritSearchProvider(() => options).search({ query: "rust 2024", maxResults: 8 });
    expect(client.search).toHaveBeenCalledWith({
      query: "rust 2024",
      count: 8,
      chunksPerDoc: 2,
      highlights: true,
      needContent: true,
      contentMaxChars: 1_500,
      needMarkdown: true,
      rank: { preference: "freshness" },
      filters: {
        sites: { include: ["github.com"], exclude: ["pinterest.com", "facebook.com"] },
        timeRange: { date: "m3" },
        geo: { countries: { include: ["united states"] } },
        languages: { include: ["english", "russian"] },
      },
    }, undefined);
  });

  it("routes code searches to the vertical and drops the rank it rejects", async () => {
    const client = fakeClient({ search: vi.fn(async () => ({ query: "q", results: [] })) });
    const options = makeOptions({ vertical: "code", rank: "freshness", resourceTags: ["qa", "github"] });
    options.clientFactory = () => client;

    await new QueritSearchProvider(() => options).search({ query: "asyncio" });
    expect(client.search).toHaveBeenCalledWith({
      query: "asyncio",
      needContent: false,
      filters: { vertical: "code", resourceTags: { include: ["qa", "github"] } },
    }, undefined);
  });

  it("keeps rank for the finance vertical", async () => {
    const client = fakeClient({ search: vi.fn(async () => ({ query: "q", results: [] })) });
    const options = makeOptions({ vertical: "finance", rank: "freshness" });
    options.clientFactory = () => client;

    await new QueritSearchProvider(() => options).search({ query: "rates" });
    expect(client.search).toHaveBeenCalledWith({
      query: "rates",
      needContent: false,
      rank: { preference: "freshness" },
      filters: { vertical: "finance" },
    }, undefined);
  });

  it("leaves count to Querit when nothing bounds it, and clamps a bound to the API range", async () => {
    const client = fakeClient({ search: vi.fn(async () => ({ query: "q", results: [] })) });
    const options = makeOptions();
    options.clientFactory = () => client;
    const provider = new QueritSearchProvider(() => options);

    await provider.search({ query: "q" });
    expect(client.search).toHaveBeenLastCalledWith({ query: "q", needContent: false }, undefined);

    await provider.search({ query: "q", maxResults: 500 });
    expect(client.search).toHaveBeenLastCalledWith({ query: "q", count: 100, needContent: false }, undefined);

    await provider.search({ query: "q", maxResults: 0 });
    expect(client.search).toHaveBeenLastCalledWith({ query: "q", count: 1, needContent: false }, undefined);
  });

  it("reports search_id, took, and cost once the operation completes", async () => {
    const client = fakeClient({
      search: vi.fn(async () => ({
        query: "q",
        results: [],
        searchId: "9007199254740993123",
        took: "0.42",
        cost: { currency: "USD", total: 0.000001 },
      })),
    });
    const events: QueritOperationEvent[] = [];
    const options = makeOptions({ observe: (event) => events.push(event) });
    options.clientFactory = () => client;

    await new QueritSearchProvider(() => options).search({ query: "q" });

    expect(events).toEqual([{ operation: "search", searchId: "9007199254740993123", took: "0.42", cost: "USD 0.000001" }]);
  });

  it("throws WEB_PROVIDER_CREDENTIAL_MISSING when no key resolves", async () => {
    const options = makeOptions({ apiKey: undefined, resolveApiKey: async () => undefined });
    const provider = new QueritSearchProvider(() => options);

    const failure = await provider.search({ query: "q" }).catch((error: unknown) => error);
    expect(webCode(failure)).toBe("WEB_PROVIDER_CREDENTIAL_MISSING");
    expect((failure as Error).message).toContain("QUERIT_API_KEY");
  });

  it("throws WEB_ABORTED when the caller already aborted", async () => {
    const options = makeOptions();
    const provider = new QueritSearchProvider(() => options);
    const controller = new AbortController();
    controller.abort();

    const failure = await provider.search({ query: "q" }, controller.signal).catch((error: unknown) => error);
    expect(webCode(failure)).toBe("WEB_ABORTED");
  });

  it("maps client failures to WEB_PROVIDER_ERROR", async () => {
    const client = fakeClient({
      search: vi.fn(async () => {
        throw new QueritApiError("Querit API request failed with HTTP 500.");
      }),
    });
    const options = makeOptions();
    options.clientFactory = () => client;

    const failure = await new QueritSearchProvider(() => options).search({ query: "q" }).catch((error: unknown) => error);
    expect(webCode(failure)).toBe("WEB_PROVIDER_ERROR");
    expect((failure as Error).message).toContain("Querit search failed");
  });

  it("maps AbortError client failures to WEB_ABORTED", async () => {
    const client = fakeClient({
      search: vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      }),
    });
    const options = makeOptions();
    options.clientFactory = () => client;

    const failure = await new QueritSearchProvider(() => options).search({ query: "q" }).catch((error: unknown) => error);
    expect(webCode(failure)).toBe("WEB_ABORTED");
  });
});

describe("QueritFetchProvider", () => {
  it("reports availability from local facts only", () => {
    const provider = new QueritFetchProvider(() => makeOptions());
    expect(provider.available()).toBe(true);
    expect(new QueritFetchProvider(() => makeOptions({ fetchCrawlTimeout: 0 })).available()).toBe(false);
    expect(new QueritFetchProvider(() => makeOptions({ fetchMaxChars: 10 })).available()).toBe(false);
  });

  it("names itself like the search provider and answers ready the same way", async () => {
    const provider = new QueritFetchProvider(() => makeOptions());
    expect(provider.id).toBe("web-search-querit");
    expect(provider.title).toBe("Querit");
    expect(await provider.ready()).toBe(true);
    expect(await new QueritFetchProvider(() => makeOptions({ apiKey: undefined })).ready()).toBe(false);
  });

  it("maps a successful markdown crawl to a 200 text body", async () => {
    const client = fakeClient({
      contents: vi.fn(async () => ({
        results: [{ url: "https://example.com/a", content: "# Hello", highlights: [] }],
        statuses: [{ status: "success" }],
      })),
    });
    const options = makeOptions({ fetchFormat: "markdown" });
    options.clientFactory = () => client;

    const result = await new QueritFetchProvider(() => options).fetch({ url: "https://example.com/a" });
    expect(client.contents).toHaveBeenCalledWith({
      urls: ["https://example.com/a"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: false,
    }, undefined);
    expect(result).toEqual({
      url: "https://example.com/a",
      statusCode: 200,
      body: { kind: "text", content: "# Hello" },
      truncated: false,
    });
  });

  it("labels html responses with the html body kind", async () => {
    const client = fakeClient({
      contents: vi.fn(async () => ({
        results: [{ url: "https://example.com/a", content: "<p>hi</p>", highlights: [] }],
        statuses: [{ status: "success" }],
      })),
    });
    const options = makeOptions({ fetchFormat: "html" });
    options.clientFactory = () => client;

    const result = await new QueritFetchProvider(() => options).fetch({ url: "https://example.com/a" });
    expect(result.body).toEqual({ kind: "html", content: "<p>hi</p>" });
  });

  it("caps oversized content and flags truncation", async () => {
    const long = "x".repeat(1_000);
    const client = fakeClient({
      contents: vi.fn(async () => ({
        results: [{ url: "https://example.com/a", content: long, highlights: [] }],
        statuses: [{ status: "success" }],
      })),
    });
    const options = makeOptions({ fetchMaxChars: 256 });
    options.clientFactory = () => client;

    const result = await new QueritFetchProvider(() => options).fetch({ url: "https://example.com/a" });
    expect(result.truncated).toBe(true);
    expect((result.body as { content: string }).content.length).toBe(256);
    expect((result.body as { content: string }).content.endsWith("...")).toBe(true);
  });

  it("reports the operation's search_id and cost", async () => {
    const client = fakeClient({
      contents: vi.fn(async () => ({
        results: [{ url: "https://example.com/a", content: "x", highlights: [] }],
        statuses: [{ status: "success" }],
        searchId: "7",
        searchTime: 2,
        cost: { currency: "USD", total: 0.002 },
      })),
    });
    const events: QueritOperationEvent[] = [];
    const options = makeOptions({ observe: (event) => events.push(event) });
    options.clientFactory = () => client;

    await new QueritFetchProvider(() => options).fetch({ url: "https://example.com/a" });
    expect(events).toEqual([{ operation: "fetch", searchId: "7", took: "2s", cost: "USD 0.002000" }]);
  });

  it("throws WEB_PROVIDER_ERROR when the crawl fails", async () => {
    const client = fakeClient({
      contents: vi.fn(async () => ({ results: [], statuses: [{ status: "failed" }] })),
    });
    const options = makeOptions();
    options.clientFactory = () => client;

    const failure = await new QueritFetchProvider(() => options).fetch({ url: "https://example.com/a" }).catch((error: unknown) => error);
    expect(webCode(failure)).toBe("WEB_PROVIDER_ERROR");
    expect((failure as Error).message).toContain("failed");
  });

  it("throws WEB_PROVIDER_ERROR when nothing is returned", async () => {
    const client = fakeClient({ contents: vi.fn(async () => ({ results: [], statuses: [] })) });
    const options = makeOptions();
    options.clientFactory = () => client;

    const failure = await new QueritFetchProvider(() => options).fetch({ url: "https://example.com/a" }).catch((error: unknown) => error);
    expect(webCode(failure)).toBe("WEB_PROVIDER_ERROR");
  });
});
