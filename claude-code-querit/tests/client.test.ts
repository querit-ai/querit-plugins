import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  QUERIT_API_BASE_URL,
  QueritApiError,
  QueritClient,
} from "../src/client.js";

const TEST_API_KEY = "test-api-key-placeholder";
type FetchImpl = typeof fetch;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function capturingFetch(): {
  fetchImpl: FetchImpl;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const body = String(input).endsWith("/v1/search")
      ? { results: { result: [] } }
      : { results: [], statuses: [] };
    return jsonResponse(body);
  }) as unknown as FetchImpl;
  return { fetchImpl, calls };
}

describe("QueritClient", () => {
  it("posts search requests with the bearer key and expected body", async () => {
    const { fetchImpl, calls } = capturingFetch();
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

    await client.search({ query: "test query", count: 5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${QUERIT_API_BASE_URL}/v1/search`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe(`Bearer ${TEST_API_KEY}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ query: "test query", count: 5 });
  });

  it("posts contents requests to /v1/contents", async () => {
    const { fetchImpl, calls } = capturingFetch();
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

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

  it("normalizes and deduplicates search results while keeping safe HTTP(S) URLs", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      search_id: "42",
      took: "0.5s",
      query_context: { query: "resolved query" },
      results: {
        result: [
          {
            title: "First",
            url: "https://example.com/a",
            snippet: "snippet A",
            page_age: "2d",
            site_name: "Example",
            site_icon: "https://example.com/icon.png",
            sentence: ["s1", "s2", 3],
          },
          { title: "Duplicate", url: "https://example.com/a" },
          { title: "FTP", url: "ftp://example.com/file" },
          { title: "Credentials", url: "https://user:pass@example.com/private" },
          { title: "Invalid", url: "not-a-url" },
        ],
      },
    })) as unknown as FetchImpl;

    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });
    const response = await client.search({ query: "original", count: 5 });

    expect(response).toEqual({
      searchId: "42",
      took: "0.5s",
      query: "resolved query",
      results: [{
        title: "First",
        url: "https://example.com/a",
        snippet: "snippet A",
        pageAge: "2d",
        siteName: "Example",
        siteIcon: "https://example.com/icon.png",
        sentences: ["s1", "s2"],
      }],
    });
  });

  it("normalizes contents, statuses, and metadata", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      search_id: 7,
      results: [
        {
          id: "1",
          url: "https://example.com/a",
          content: "hello",
          extrasMeta: {
            title: "Title",
            url: "https://example.com/canonical",
            siteName: "Example",
            publishTime: "2026-01-01",
          },
        },
        { id: "duplicate", url: "https://example.com/a", content: "ignored" },
      ],
      statuses: [{ id: "1", status: "success" }],
      searchTime: 1.2,
    })) as unknown as FetchImpl;

    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });
    const response = await client.contents({
      urls: ["https://example.com/a"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
    });

    expect(response.searchId).toBe("7");
    expect(response.results).toEqual([{
      id: "1",
      url: "https://example.com/a",
      content: "hello",
      metadata: {
        title: "Title",
        url: "https://example.com/canonical",
        publishTime: "2026-01-01",
        siteName: "Example",
        siteIcon: undefined,
      },
    }]);
    expect(response.statuses).toEqual([{ id: "1", status: "success" }]);
    expect(response.searchTime).toBe(1.2);
  });

  it("redacts and sanitizes API error messages", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      error_code: "401",
      error_msg: `invalid key ${TEST_API_KEY} \u001b[31mrejected\u001b[0m`,
    }, 401)) as unknown as FetchImpl;
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

    await expect(client.search({ query: "q", count: 1 })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(QueritApiError);
      const apiError = error as QueritApiError;
      expect(apiError.message).toContain("invalid key [REDACTED] rejected");
      expect(apiError.message).not.toContain(TEST_API_KEY);
      expect(apiError.message).not.toContain("\u001b");
      expect(apiError.status).toBe(401);
      return true;
    });
  });

  it("redacts the API key from network errors and their public cause", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`socket failed for ${TEST_API_KEY}\u001b[2J`);
    }) as unknown as FetchImpl;
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

    await expect(client.search({ query: "q", count: 1 })).rejects.toSatisfy((error: unknown) => {
      const apiError = error as QueritApiError;
      expect(apiError.message).toBe("Querit request failed: socket failed for [REDACTED]");
      expect(apiError.message).not.toContain(TEST_API_KEY);
      expect(String(apiError.cause)).not.toContain(TEST_API_KEY);
      return true;
    });
  });

  it("treats a non-200 business error code as a failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      error_code: "429",
      error_msg: "quota exceeded",
    })) as unknown as FetchImpl;
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

    await expect(client.search({ query: "q", count: 1 })).rejects.toMatchObject({
      message: "quota exceeded",
      status: 200,
    });
  });

  it("rejects invalid JSON and oversized search responses", async () => {
    const invalidJson = vi.fn(async () => new Response("<html>not json</html>")) as unknown as FetchImpl;
    await expect(new QueritClient({ apiKey: TEST_API_KEY, fetchImpl: invalidJson })
      .search({ query: "q", count: 1 })).rejects.toThrow("invalid JSON");

    const oversized = vi.fn(async () => new Response("x", {
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    })) as unknown as FetchImpl;
    await expect(new QueritClient({ apiKey: TEST_API_KEY, fetchImpl: oversized })
      .search({ query: "q", count: 1 })).rejects.toThrow("2097152-byte limit");
  });

  it("stops reading a streamed response after the byte limit", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    }))) as unknown as FetchImpl;
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

    await expect(client.search({ query: "q", count: 1 })).rejects.toThrow("2097152-byte limit");
  });

  it("validates credentials, base URLs, and timeout options", () => {
    expect(() => new QueritClient({ apiKey: "   " })).toThrow("API key is required");
    expect(() => new QueritClient({ apiKey: TEST_API_KEY, baseUrl: "file:///tmp/api" })).toThrow("HTTP(S)");
    expect(() => new QueritClient({ apiKey: TEST_API_KEY, baseUrl: "https://user:pass@example.com" })).toThrow("credentials");
    expect(() => new QueritClient({ apiKey: TEST_API_KEY, timeoutMs: 999 })).toThrow("at least 1000");
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(70_000);
  });
});
