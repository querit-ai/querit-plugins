import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  QUERIT_API_BASE_URL,
  QueritApiError,
  QueritClient,
} from "../src/client.js";

const TEST_KEY = "sk-test-secret-key-123";

type FetchInput = string | URL | Request;
type FetchImpl = (input: FetchInput, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function capturingFetch(): { fetch: FetchImpl; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchImpl = vi.fn(async (input: FetchInput, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const url = String(input);
    const body = url.endsWith("/v1/search") ? { results: { result: [] } } : { results: [], statuses: [] };
    return jsonResponse(body);
  }) as unknown as FetchImpl;
  return { fetch, calls };
}

describe("QueritClient", () => {
  it("posts search requests to the default base URL with the bearer key", async () => {
    const { fetch, calls } = capturingFetch();
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetch });
    await client.search({ query: "test query", count: 5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${QUERIT_API_BASE_URL}/v1/search`);
    const init = calls[0]!.init;
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TEST_KEY}`);
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ query: "test query", count: 5 });
  });

  it("posts contents requests to /v1/contents", async () => {
    const { fetch, calls } = capturingFetch();
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetch });
    await client.contents({
      urls: ["https://example.com/page"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: false,
    });

    expect(calls[0]!.url).toBe(`${QUERIT_API_BASE_URL}/v1/contents`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      urls: ["https://example.com/page"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: false,
    });
  });

  it("parses and deduplicates search results, keeping HTTP(S) URLs only", async () => {
    const fetch = vi.fn(async () => jsonResponse({
      search_id: "42",
      took: "0.5s",
      query_context: { query: "resolved query" },
      results: {
        result: [
          { title: "First", url: "https://example.com/a", snippet: "snippet A", page_age: "2d", site_name: "Ex", sentence: ["s1", "s2"] },
          { title: "Dup", url: "https://example.com/a", snippet: "dup" },
          { title: "Ftp", url: "ftp://example.com/b", snippet: "skip me" },
          { title: "Not a url", url: "not-a-url", snippet: "skip me too" },
        ],
      },
    })) as unknown as FetchImpl;

    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetch });
    const response = await client.search({ query: "original", count: 5 });

    expect(response.searchId).toBe("42");
    expect(response.took).toBe("0.5s");
    expect(response.query).toBe("resolved query");
    expect(response.results).toEqual([
      {
        title: "First",
        url: "https://example.com/a",
        snippet: "snippet A",
        pageAge: "2d",
        siteName: "Ex",
        siteIcon: undefined,
        sentences: ["s1", "s2"],
      },
    ]);
  });

  it("parses contents responses with statuses", async () => {
    const fetch = vi.fn(async () => jsonResponse({
      results: [
        { id: "1", url: "https://example.com/a", content: "hello", extrasMeta: { title: "T" } },
        { id: "1", url: "https://example.com/a", content: "dup" },
      ],
      statuses: [{ id: "1", status: "success" }],
      searchTime: 1.2,
    })) as unknown as FetchImpl;

    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetch });
    const response = await client.contents({
      urls: ["https://example.com/a"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: false,
    });

    expect(response.results).toEqual([{ id: "1", url: "https://example.com/a", content: "hello" }]);
    expect(response.statuses).toEqual([{ id: "1", status: "success" }]);
    expect(response.searchTime).toBe(1.2);
  });

  it("throws on HTTP errors and redacts the API key from error details", async () => {
    const fetch = vi.fn(async () => jsonResponse(
      { error_code: "401", error_msg: `invalid key ${TEST_KEY} rejected` },
      401,
    )) as unknown as FetchImpl;

    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetch });
    await expect(client.search({ query: "q", count: 3 })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(QueritApiError);
      const message = (error as QueritApiError).message;
      expect(message).toContain("invalid key");
      expect(message).toContain("[REDACTED]");
      expect(message).not.toContain(TEST_KEY);
      expect((error as QueritApiError).status).toBe(401);
      return true;
    });
  });

  it("treats a non-200 business error_code inside a 200 response as a failure", async () => {
    const fetch = vi.fn(async () => jsonResponse({ error_code: "429", error_msg: "quota exceeded" })) as unknown as FetchImpl;

    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetch });
    await expect(client.search({ query: "q", count: 3 })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(QueritApiError);
      expect((error as QueritApiError).message).toBe("quota exceeded");
      expect((error as QueritApiError).status).toBe(200);
      return true;
    });
  });

  it("throws on invalid JSON responses", async () => {
    const fetch = vi.fn(async () => new Response("<html>not json</html>", { status: 200 })) as unknown as FetchImpl;

    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetch });
    await expect(client.search({ query: "q", count: 3 })).rejects.toThrow("invalid JSON");
  });

  it("rejects oversized responses before reading the body", async () => {
    const fetch = vi.fn(async () => new Response("x", {
      status: 200,
      headers: { "content-length": String(3 * 1024 * 1024) },
    })) as unknown as FetchImpl;

    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetch });
    await expect(client.search({ query: "q", count: 3 })).rejects.toThrow("2");
  });

  it("requires a non-empty API key", () => {
    expect(() => new QueritClient({ apiKey: "   " })).toThrow("API key is required");
  });

  it("honors a custom base URL and timeout", async () => {
    const { fetch, calls } = capturingFetch();
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetch, baseUrl: "https://proxy.example/", timeoutMs: 42_000 });
    await client.search({ query: "q", count: 1 });
    expect(calls[0]!.url).toBe("https://proxy.example/v1/search");
  });

  it("uses the default timeout when omitted", () => {
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: undefined as unknown as typeof fetch });
    void client;
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(70_000);
  });
});
