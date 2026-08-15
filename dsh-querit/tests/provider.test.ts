import { describe, expect, it, vi } from "vitest";
import { QueritApiError } from "../src/client.js";
import {
  QueritFetchProvider,
  QueritSearchProvider,
  isTimeRange,
  normalizeDomains,
  type QueritClientLike,
  type QueritProviderOptions,
} from "../src/provider.js";

function makeOptions(overrides: Partial<QueritProviderOptions> = {}): QueritProviderOptions {
  return {
    apiKey: "sk-test-key",
    baseURL: "https://api.querit.ai",
    timeoutMs: 70_000,
    count: 5,
    countries: [],
    languages: [],
    includeDomains: [],
    excludeDomains: [],
    includeContent: false,
    chunksPerDoc: 1,
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
    const options = makeOptions();
    expect(new QueritSearchProvider(() => options).available()).toBe(true);

    expect(new QueritSearchProvider(() => makeOptions({ apiKey: undefined, resolveApiKey: async () => "k" })).available()).toBe(true);
    expect(new QueritSearchProvider(() => makeOptions({ apiKey: undefined })).available()).toBe(false);
    expect(new QueritSearchProvider(() => makeOptions({ baseURL: "not a url" })).available()).toBe(false);
    expect(new QueritSearchProvider(() => makeOptions({ timeRange: "yesterday" })).available()).toBe(false);
    expect(new QueritSearchProvider(() => makeOptions({ count: 99 })).available()).toBe(false);
  });

  it("maps results to sources and merges snippets with sentences", async () => {
    const client = fakeClient({
      search: vi.fn(async () => ({
        query: "q",
        results: [
          { title: "Page", url: "https://example.com/a", snippet: "intro", pageAge: "3d", sentences: ["fact one", "fact two"] },
          { title: "No age", url: "https://example.com/b", snippet: " ", sentences: [] },
        ],
      })),
    });
    const options = makeOptions();
    options.clientFactory = () => client;
    const provider = new QueritSearchProvider(() => options);

    const result = await provider.search({ query: "q" });
    expect(result.truncated).toBe(false);
    expect(result.content).toBeUndefined();
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toEqual({
      url: "https://example.com/a",
      title: "Page",
      snippet: "intro\n- fact one\n- fact two",
      publishedAt: "3d",
    });
    expect(result.sources[1]).toEqual({ url: "https://example.com/b", title: "No age" });
  });

  it("builds the request filters from the configured defaults", async () => {
    const client = fakeClient({
      search: vi.fn(async () => ({ query: "q", results: [] })),
    });
    const options = makeOptions({
      count: 5,
      timeRange: "m3",
      countries: ["united states"],
      languages: ["english"],
      includeDomains: ["github.com"],
      excludeDomains: ["pinterest.com", "facebook.com"],
      includeContent: true,
      chunksPerDoc: 2,
    });
    options.clientFactory = () => client;
    const provider = new QueritSearchProvider(() => options);

    await provider.search({ query: "rust 2024", maxResults: 8 });
    expect(client.search).toHaveBeenCalledWith({
      query: "rust 2024",
      count: 8,
      chunksPerDoc: 2,
      needContent: true,
      filters: {
        sites: { include: ["github.com"], exclude: ["pinterest.com", "facebook.com"] },
        timeRange: { date: "m3" },
        geo: { countries: { include: ["united states"] } },
        languages: { include: ["english"] },
      },
    }, undefined);
  });

  it("clamps the requested count to the API range and omits filters when empty", async () => {
    const client = fakeClient({
      search: vi.fn(async () => ({ query: "q", results: [] })),
    });
    const options = makeOptions({ count: 5 });
    options.clientFactory = () => client;
    const provider = new QueritSearchProvider(() => options);

    await provider.search({ query: "q", maxResults: 40 });
    expect(client.search).toHaveBeenCalledWith({
      query: "q",
      count: 20,
      chunksPerDoc: 1,
      needContent: false,
    }, undefined);
  });

  it("throws WEB_PROVIDER_CREDENTIAL_MISSING when no key resolves", async () => {
    const options = makeOptions({ apiKey: undefined, resolveApiKey: async () => undefined });
    const provider = new QueritSearchProvider(() => options);

    await expect(provider.search({ query: "q" })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as { code?: string }).code).toBe("WEB_PROVIDER_CREDENTIAL_MISSING");
      return true;
    });
  });

  it("throws WEB_ABORTED when the caller already aborted", async () => {
    const options = makeOptions();
    const provider = new QueritSearchProvider(() => options);
    const controller = new AbortController();
    controller.abort();

    await expect(provider.search({ query: "q" }, controller.signal)).rejects.toSatisfy((error: unknown) => {
      expect((error as { code?: string }).code).toBe("WEB_ABORTED");
      return true;
    });
  });

  it("maps client failures to WEB_PROVIDER_ERROR", async () => {
    const client = fakeClient({
      search: vi.fn(async () => {
        throw new QueritApiError("Querit API request failed with HTTP 500.");
      }),
    });
    const options = makeOptions();
    options.clientFactory = () => client;
    const provider = new QueritSearchProvider(() => options);

    await expect(provider.search({ query: "q" })).rejects.toSatisfy((error: unknown) => {
      expect((error as { code?: string }).code).toBe("WEB_PROVIDER_ERROR");
      expect((error as Error).message).toContain("Querit search failed");
      return true;
    });
  });

  it("maps AbortError client failures to WEB_ABORTED", async () => {
    const client = fakeClient({
      search: vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      }),
    });
    const options = makeOptions();
    options.clientFactory = () => client;
    const provider = new QueritSearchProvider(() => options);

    await expect(provider.search({ query: "q" })).rejects.toSatisfy((error: unknown) => {
      expect((error as { code?: string }).code).toBe("WEB_ABORTED");
      return true;
    });
  });
});

describe("QueritFetchProvider", () => {
  it("reports availability from local facts only", () => {
    const options = makeOptions();
    expect(new QueritFetchProvider(() => options).available()).toBe(true);
    expect(new QueritFetchProvider(() => makeOptions({ fetchCrawlTimeout: 0 })).available()).toBe(false);
    expect(new QueritFetchProvider(() => makeOptions({ fetchMaxChars: 10 })).available()).toBe(false);
  });

  it("maps a successful markdown crawl to a 200 text body", async () => {
    const client = fakeClient({
      contents: vi.fn(async () => ({
        results: [{ url: "https://example.com/a", content: "# Hello" }],
        statuses: [{ status: "success" }],
      })),
    });
    const options = makeOptions({ fetchFormat: "markdown" });
    options.clientFactory = () => client;
    const provider = new QueritFetchProvider(() => options);

    const result = await provider.fetch({ url: "https://example.com/a" });
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
        results: [{ url: "https://example.com/a", content: "<p>hi</p>" }],
        statuses: [{ status: "success" }],
      })),
    });
    const options = makeOptions({ fetchFormat: "html" });
    options.clientFactory = () => client;
    const provider = new QueritFetchProvider(() => options);

    const result = await provider.fetch({ url: "https://example.com/a" });
    expect(result.body).toEqual({ kind: "html", content: "<p>hi</p>" });
  });

  it("caps oversized content and flags truncation", async () => {
    const long = "x".repeat(1_000);
    const client = fakeClient({
      contents: vi.fn(async () => ({
        results: [{ url: "https://example.com/a", content: long }],
        statuses: [{ status: "success" }],
      })),
    });
    const options = makeOptions({ fetchMaxChars: 256 });
    options.clientFactory = () => client;
    const provider = new QueritFetchProvider(() => options);

    const result = await provider.fetch({ url: "https://example.com/a" });
    expect(result.truncated).toBe(true);
    expect((result.body as { content: string }).content.length).toBe(256);
    expect((result.body as { content: string }).content.endsWith("...")).toBe(true);
  });

  it("throws WEB_PROVIDER_ERROR when the crawl fails", async () => {
    const client = fakeClient({
      contents: vi.fn(async () => ({
        results: [],
        statuses: [{ status: "failed" }],
      })),
    });
    const options = makeOptions();
    options.clientFactory = () => client;
    const provider = new QueritFetchProvider(() => options);

    await expect(provider.fetch({ url: "https://example.com/a" })).rejects.toSatisfy((error: unknown) => {
      expect((error as { code?: string }).code).toBe("WEB_PROVIDER_ERROR");
      expect((error as Error).message).toContain("failed");
      return true;
    });
  });

  it("throws WEB_PROVIDER_ERROR when nothing is returned", async () => {
    const client = fakeClient({
      contents: vi.fn(async () => ({ results: [], statuses: [] })),
    });
    const options = makeOptions();
    options.clientFactory = () => client;
    const provider = new QueritFetchProvider(() => options);

    await expect(provider.fetch({ url: "https://example.com/a" })).rejects.toSatisfy((error: unknown) => {
      expect((error as { code?: string }).code).toBe("WEB_PROVIDER_ERROR");
      return true;
    });
  });
});
