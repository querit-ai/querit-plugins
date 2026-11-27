import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  QUERIT_API_BASE_URL,
  QueritApiError,
  QueritClient,
  formatCost,
  parseRetryAfter,
  type QueritContentsRequest,
  type QueritRetryOptions,
} from "../src/client.js";

const PACKAGE_VERSION = (JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as { version: string }).version;

const TEST_KEY = "sk-test-secret-key-123";

const CONTENTS_REQUEST: QueritContentsRequest = {
  urls: ["https://example.com/page"],
  format: "markdown",
  crawlTimeout: 10,
  extrasMeta: false,
};

function jsonResponse(body: string | object, init: ResponseInit = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

function transientFailure(status: number, headers: Record<string, string> = {}): Response {
  return jsonResponse({ error_code: status, error_msg: `transient ${status}`, search_id: 5 }, { status, headers });
}

/**
 * Near-zero waits, so retry logic is exercised without slowing the suite.
 * A Response body can be read once, so every attempt must get its own.
 */
function retryingClient(
  retry: Partial<QueritRetryOptions>,
  ...responses: Response[]
): { fetchMock: ReturnType<typeof vi.fn<typeof fetch>>; client: QueritClient } {
  const queue = [...responses];
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
    const response = queue.shift();
    if (!response) throw new Error("the test ran out of queued responses");
    return response;
  });
  const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock, retry });
  return { fetchMock, client };
}

/** The default retry budget (two retries) with near-zero waits. */
function fastRetryClient(...responses: Response[]) {
  return retryingClient({ baseDelayMs: 1, maxDelayMs: 2 }, ...responses);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("QueritClient", () => {
  it("posts search requests to the default base URL with the bearer key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ results: { result: [] } }));
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });

    await client.search({ query: "test query", count: 5 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${QUERIT_API_BASE_URL}/v1/search`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TEST_KEY}`);
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(init?.headers).get("user-agent")).toBe(`dsh-querit/${PACKAGE_VERSION}`);
    expect(JSON.parse(String(init?.body))).toEqual({ query: "test query", count: 5 });
  });

  it("posts contents requests to /v1/contents", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ results: [], statuses: [] }));
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });

    await client.contents(CONTENTS_REQUEST);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${QUERIT_API_BASE_URL}/v1/contents`);
    expect(JSON.parse(String(init?.body))).toEqual(CONTENTS_REQUEST);
  });

  it("forwards the newer search parameters untouched", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error_code: 200, results: { result: [] } }));
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });

    await client.search({
      query: "asyncio semaphore",
      highlights: { query: "rate limiter", maxCharacters: 300 },
      needContent: true,
      contentMaxChars: 2_000,
      needMarkdown: true,
      rank: { preference: "freshness" },
      filters: { vertical: "code", resourceTags: { include: ["qa", "github"] } },
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      query: "asyncio semaphore",
      highlights: { query: "rate limiter", maxCharacters: 300 },
      needContent: true,
      contentMaxChars: 2_000,
      needMarkdown: true,
      rank: { preference: "freshness" },
      filters: { vertical: "code", resourceTags: { include: ["qa", "github"] } },
    });
  });

  it("parses and deduplicates search results, keeping HTTP(S) URLs only", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
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
    }));

    const response = await new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock }).search({ query: "original" });

    expect(response.searchId).toBe("42");
    expect(response.took).toBe("0.5s");
    expect(response.query).toBe("resolved query");
    expect(response.cost).toBeUndefined();
    expect(response.results).toEqual([{
      title: "First",
      url: "https://example.com/a",
      snippet: "snippet A",
      pageAge: "2d",
      siteName: "Ex",
      siteIcon: undefined,
      sentences: ["s1", "s2"],
      highlights: [],
      snippetMarkdown: undefined,
      contentMarkdown: undefined,
    }]);
  });

  it("reads cost, highlights, and Markdown fields, tolerating their absence", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(
      '{"error_code":200,"search_id":8,"cost":{"currency":"USD","total":0.000123},"results":{"result":'
      + '[{"url":"https://example.com/a","title":"A","snippet":"one","highlights":["relevant fragment"],"snippet_markdown":["**one**"],"content_markdown":"# body"},'
      + '{"url":"https://example.com/b","title":"B","highlights":"not a list"}]}}',
    ));
    const response = await new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock }).search({ query: "pi" });

    expect(response.cost).toEqual({ currency: "USD", total: 0.000123 });
    expect(response.results.map((item) => [item.highlights, item.snippetMarkdown, item.contentMarkdown])).toEqual([
      [["relevant fragment"], ["**one**"], "# body"],
      [[], undefined, undefined],
    ]);
  });

  it("parses contents responses with statuses and highlights", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      cost: { currency: "USD", total: 0 },
      results: [
        { id: "1", url: "https://example.com/a", content: "hello", highlights: ["the fact"], extrasMeta: { title: "T" } },
        { id: "1", url: "https://example.com/a", content: "dup", highlights: [] },
      ],
      statuses: [{ id: "1", status: "success" }],
      searchTime: 1.2,
    }));

    const response = await new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock }).contents({
      ...CONTENTS_REQUEST,
      contentMaxChars: 4_000,
      highlights: { maxCharacters: 2_000 },
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      ...CONTENTS_REQUEST,
      contentMaxChars: 4_000,
      highlights: { maxCharacters: 2_000 },
    });
    expect(response.cost).toEqual({ currency: "USD", total: 0 });
    // Same client as pi-querit: optional page metadata is parsed when extrasMeta is requested.
    expect(response.results).toEqual([{
      id: "1",
      url: "https://example.com/a",
      content: "hello",
      highlights: ["the fact"],
      metadata: { title: "T", url: undefined, publishTime: undefined, siteName: undefined, siteIcon: undefined },
    }]);
    expect(response.statuses).toEqual([{ id: "1", status: "success" }]);
    expect(response.searchTime).toBe(1.2);
  });

  it("throws on HTTP errors and redacts the API key from error details", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(
      { error_code: "401", error_msg: `invalid key ${TEST_KEY} rejected`, search_id: 7 },
      { status: 401 },
    ));

    await expect(new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock }).search({ query: "q" })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(QueritApiError);
      const message = (error as QueritApiError).message;
      expect(message).toContain("invalid key");
      expect(message).toContain("[REDACTED]");
      expect(message).not.toContain(TEST_KEY);
      expect((error as QueritApiError).status).toBe(401);
      expect((error as QueritApiError).searchId).toBe("7");
      return true;
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("takes error_code as the verdict even on an HTTP 200, and retries only the transient codes", async () => {
    // Querit documents error_code as matching the HTTP status, and asks for it to be checked on a 200 too.
    const refused = fastRetryClient(jsonResponse({ error_code: "403", error_msg: "quota exhausted", search_id: 9 }));
    await expect(refused.client.search({ query: "q" })).rejects.toMatchObject({
      message: "quota exhausted [search_id: 9]",
      status: 403,
      attempts: 1,
    });
    expect(refused.fetchMock).toHaveBeenCalledOnce();

    const rateLimited = fastRetryClient(
      jsonResponse({ error_code: "429", error_msg: "rate limited", search_id: 10 }),
      jsonResponse({ error_code: 200, results: { result: [] } }),
    );
    await expect(rateLimited.client.search({ query: "q" })).resolves.toMatchObject({ results: [] });
    expect(rateLimited.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 429, 500, and 503 with backoff until a request succeeds", async () => {
    const success = jsonResponse({ error_code: 200, results: { result: [{ url: "https://example.com/" }] } });
    const { fetchMock, client } = retryingClient(
      { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2 },
      transientFailure(429),
      transientFailure(500),
      transientFailure(503),
      success,
    );

    const result = await client.search({ query: "q" });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.results).toHaveLength(1);
  });

  it("gives up after the default budget of two retries and reports the attempt count", async () => {
    const { fetchMock, client } = fastRetryClient(transientFailure(503), transientFailure(503), transientFailure(503));

    await expect(client.search({ query: "q" })).rejects.toMatchObject({
      status: 503,
      searchId: "5",
      attempts: 3,
      message: "Querit request failed after 3 attempts: transient 503 [search_id: 5]",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never retries 400, 401, 403, or 404", async () => {
    for (const status of [400, 401, 403, 404]) {
      const { fetchMock, client } = fastRetryClient(transientFailure(status));
      await expect(client.search({ query: "q" })).rejects.toMatchObject({ status, attempts: 1 });
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  });

  it("waits for a bounded, jittered backoff between attempts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(transientFailure(500))
      .mockResolvedValueOnce(jsonResponse({ results: [], statuses: [] }));
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock, retry: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 100 } });

    const request = client.contents(CONTENTS_REQUEST);
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(51);
    await expect(request).resolves.toMatchObject({ results: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors a Retry-After that fits the wait budget", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(transientFailure(429, { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonResponse({ results: { result: [] } }));
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock, retry: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 3_000 } });

    const request = client.search({ query: "q" });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toMatchObject({ results: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not wait out a Retry-After longer than the budget", async () => {
    const { fetchMock, client } = fastRetryClient(transientFailure(429, { "retry-after": "30" }));

    await expect(client.search({ query: "q" })).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 30_000,
      attempts: 1,
      message: expect.stringContaining("retry after 30s, longer than the 2 ms this client waits; not retried"),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("stops retrying when the caller cancels during the backoff wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(transientFailure(503));
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock, retry: { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 1_000 } });
    const controller = new AbortController();

    const request = client.search({ query: "q" }, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "QueritApiError", message: "Querit request was cancelled." });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws on invalid JSON responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>not json</html>", { status: 200 }));

    await expect(new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock }).search({ query: "q" })).rejects.toThrow("invalid JSON");
  });

  it("rejects oversized responses before reading the body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("x", {
      status: 200,
      headers: { "content-length": String(3 * 1024 * 1024) },
    }));

    await expect(new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock }).search({ query: "q" })).rejects.toThrow("response exceeds the 2");
  });

  it("requires a non-empty API key", () => {
    expect(() => new QueritClient({ apiKey: "   " })).toThrow("API key is required");
  });

  it("honors a custom base URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ results: { result: [] } }));
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock, baseUrl: "https://proxy.example/", timeoutMs: 42_000 });

    await client.search({ query: "q", count: 1 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://proxy.example/v1/search");
  });

  it("times out an unresponsive request without retrying", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock, timeoutMs: 5 });

    await expect(client.search({ query: "q" })).rejects.toMatchObject({ message: "Querit request timed out after 5 ms." });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses the default timeout when omitted", () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(70_000);
  });
});

describe("Retry-After parsing", () => {
  it("reads delay-seconds and HTTP-dates", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter("1.5")).toBe(1_500);
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:00 GMT", Date.parse("2026-01-01T00:00:00Z") - 4_000)).toBe(4_000);
  });

  it("treats a date in the past as no wait and garbage as no header", () => {
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:00 GMT", Date.parse("2026-01-02T00:00:00Z"))).toBe(0);
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("cost formatting", () => {
  it("keeps six decimal places so small charges stay visible", () => {
    expect(formatCost({ currency: "USD", total: 0.000001 })).toBe("USD 0.000001");
    expect(formatCost({ currency: "USD", total: 0 })).toBe("USD 0.000000");
  });
});
