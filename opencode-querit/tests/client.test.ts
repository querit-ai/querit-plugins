import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  QUERIT_API_BASE_URL,
  QueritClient,
  formatCost,
  parseRetryAfter,
  type QueritCost,
  type QueritRetryOptions,
} from "../src/client.js";

const TEST_KEY = "sk-test-secret-key-123";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(text, { ...init, headers });
}

/** A transient HTTP failure that carries search_id. */
function transientFailure(status: number, headers: Record<string, string> = {}): Response {
  return jsonResponse({ error_code: status, error_msg: `transient ${status}`, search_id: 5 }, { status, headers });
}

/** A failure delivered on an HTTP 200: only the body's error_code names it. */
function businessFailure(code: number): Response {
  return jsonResponse({ error_code: code, error_msg: `business ${code}`, search_id: 11 });
}

const success = (): Response => jsonResponse({ error_code: 200, results: { result: [{ url: "https://example.com/" }] } });

/**
 * Near-zero waits, so retry logic is exercised without slowing the suite.
 * A Response body can be read once, so every attempt must get its own.
 */
function retryingClient(
  retry: Partial<QueritRetryOptions>,
  ...responses: Response[]
): { fetchMock: FetchMock; client: QueritClient } {
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

/** A fetch that never answers until its signal aborts. */
function hangingFetch(): FetchMock {
  return vi.fn<typeof fetch>().mockImplementation(
    async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  );
}

/** The body of the first request a mock fetch received. */
function sentBody(fetchMock: FetchMock): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("QueritClient", () => {
  it("posts search requests to the default base URL with the bearer key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(success());
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });
    await client.search({ query: "test query", count: 5 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${QUERIT_API_BASE_URL}/v1/search`);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TEST_KEY}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(sentBody(fetchMock)).toEqual({ query: "test query", count: 5 });
  });

  it("leaves count and chunksPerDoc out when the caller did not set them", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(success());
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });

    await client.search({ query: "test query" });

    expect(sentBody(fetchMock)).toEqual({ query: "test query" });
  });

  it("forwards the newer search parameters untouched", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(success());
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });

    await client.search({
      query: "asyncio semaphore",
      highlights: { query: "rate limiter", maxCharacters: 300 },
      needContent: true,
      contentMaxChars: 2_000,
      needMarkdown: true,
      chunksPerDoc: 2,
      rank: { preference: "freshness" },
      filters: { vertical: "finance", resourceTags: { include: ["qa", "github"] } },
    });

    expect(sentBody(fetchMock)).toEqual({
      query: "asyncio semaphore",
      highlights: { query: "rate limiter", maxCharacters: 300 },
      needContent: true,
      contentMaxChars: 2_000,
      needMarkdown: true,
      chunksPerDoc: 2,
      rank: { preference: "freshness" },
      filters: { vertical: "finance", resourceTags: { include: ["qa", "github"] } },
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
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });

    const response = await client.search({ query: "original" });

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
      '{"error_code":200,"search_id":8,"took":"0.42","cost":{"currency":"USD","total":0.000123},"results":{"result":'
      + '[{"url":"https://example.com/a","title":"A","snippet":"one","highlights":["relevant fragment"],"snippet_markdown":["**one**"],"content_markdown":"# body"},'
      + '{"url":"https://example.com/b","title":"B"},{"url":"https://example.com/c","highlights":"not a list"}]}}',
    ));
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });

    const response = await client.search({ query: "pi" });

    expect(response.cost).toEqual({ currency: "USD", total: 0.000123 });
    expect(response.results.map((item) => [item.highlights, item.snippetMarkdown, item.contentMarkdown])).toEqual([
      [["relevant fragment"], ["**one**"], "# body"],
      [[], undefined, undefined],
      [[], undefined, undefined],
    ]);
  });

  it("posts contents requests to /v1/contents", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ results: [], statuses: [] }),
    );
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });
    await client.contents({
      urls: ["https://example.com/page"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: false,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${QUERIT_API_BASE_URL}/v1/contents`);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TEST_KEY}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      urls: ["https://example.com/page"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: false,
    });
  });

  it("sends contentMaxChars and highlights with a contents request and reads them back", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error_code: 200,
      search_id: 42,
      cost: { currency: "USD", total: 0 },
      results: [{
        id: "a",
        url: "https://example.com",
        content: "# Example",
        highlights: ["the fact"],
        extrasMeta: { title: "Example", publishTime: "2026-01-01", siteName: "Example" },
      }],
      statuses: [{ id: "a", status: "success" }],
      searchTime: 1,
    }));
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });

    const response = await client.contents({
      urls: ["https://example.com"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
      contentMaxChars: 4_000,
      highlights: { maxCharacters: 2_000 },
    });

    expect(sentBody(fetchMock)).toEqual({
      urls: ["https://example.com"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
      contentMaxChars: 4_000,
      highlights: { maxCharacters: 2_000 },
    });
    expect(response.searchId).toBe("42");
    expect(response.cost).toEqual({ currency: "USD", total: 0 });
    expect(response.searchTime).toBe(1);
    expect(response.results).toEqual([{
      id: "a",
      url: "https://example.com/",
      content: "# Example",
      highlights: ["the fact"],
      metadata: { title: "Example", url: undefined, publishTime: "2026-01-01", siteName: "Example", siteIcon: undefined },
    }]);
    expect(response.statuses).toEqual([{ id: "a", status: "success" }]);
  });

  it("drops duplicate contents results and keeps statuses whose results never arrived", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      results: [
        { id: "1", url: "https://example.com/a", content: "hello" },
        { id: "1", url: "https://example.com/a", content: "dup" },
      ],
      statuses: [{ id: "1", status: "success" }, { id: "2", status: "failed" }],
    }));
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });

    const response = await client.contents({ urls: ["https://example.com/a", "https://example.com/b"], format: "text", crawlTimeout: 10, extrasMeta: false });

    expect(response.results).toEqual([{ id: "1", url: "https://example.com/a", content: "hello", highlights: [] }]);
    expect(response.statuses).toEqual([{ id: "1", status: "success" }, { id: "2", status: "failed" }]);
    expect(response.cost).toBeUndefined();
  });

  it("throws a redacted API error that carries search_id for authentication failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error_code: "401",
      error_msg: `\u001b[31minvalid ${TEST_KEY}\u001b[0m`,
      search_id: 7,
    }, { status: 401 }));
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });

    await expect(client.search({ query: "pi", count: 1 })).rejects.toMatchObject({
      name: "QueritApiError",
      status: 401,
      searchId: "7",
      attempts: 1,
      message: "invalid [REDACTED] [search_id: 7]",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("treats a non-200 error_code on an HTTP 200 as that failure, without retrying a 403", async () => {
    const { fetchMock, client } = fastRetryClient(businessFailure(403));

    await expect(client.search({ query: "pi" })).rejects.toMatchObject({
      status: 403,
      searchId: "11",
      attempts: 1,
      message: "business 403 [search_id: 11]",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries an HTTP 200 whose body reports error_code 429", async () => {
    const { fetchMock, client } = fastRetryClient(businessFailure(429), businessFailure(500), success());

    const response = await client.search({ query: "pi" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(response.results).toHaveLength(1);
  });

  it("trusts the HTTP status over the body when the response is not OK", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error_code: 200, error_msg: "upstream disagreed" }, { status: 502 }),
    );
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });

    await expect(client.search({ query: "pi" })).rejects.toMatchObject({
      status: 502,
      attempts: 1,
      message: "upstream disagreed",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries 429, 500, and 503 with backoff until a request succeeds", async () => {
    const { fetchMock, client } = retryingClient(
      { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2 },
      transientFailure(429),
      transientFailure(500),
      transientFailure(503),
      success(),
    );

    const response = await client.search({ query: "pi" });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(response.results).toHaveLength(1);
  });

  it("gives up after the default budget of two retries and reports the attempt count", async () => {
    const { fetchMock, client } = fastRetryClient(transientFailure(503), transientFailure(503), transientFailure(503));

    await expect(client.search({ query: "pi" })).rejects.toMatchObject({
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
      await expect(client.search({ query: "pi" })).rejects.toMatchObject({ status, attempts: 1 });
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  });

  it("waits for a bounded, jittered backoff between attempts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(transientFailure(500))
      .mockResolvedValueOnce(success());
    const client = new QueritClient({
      apiKey: TEST_KEY,
      fetchImpl: fetchMock,
      retry: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 100 },
    });

    const request = client.search({ query: "pi" });
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(51);
    await expect(request).resolves.toMatchObject({ results: [{}] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors a Retry-After that fits the wait budget", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(transientFailure(429, { "retry-after": "2" }))
      .mockResolvedValueOnce(success());
    const client = new QueritClient({
      apiKey: TEST_KEY,
      fetchImpl: fetchMock,
      retry: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 3_000 },
    });

    const request = client.search({ query: "pi" });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toMatchObject({ results: [{}] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not wait out a Retry-After longer than the budget", async () => {
    const { fetchMock, client } = fastRetryClient(transientFailure(429, { "retry-after": "30" }));

    await expect(client.search({ query: "pi" })).rejects.toMatchObject({
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
    const client = new QueritClient({
      apiKey: TEST_KEY,
      fetchImpl: fetchMock,
      retry: { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 1_000 },
    });
    const controller = new AbortController();

    const request = client.search({ query: "pi" }, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "QueritApiError", message: "Querit request was cancelled." });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports non-JSON HTTP failures with their status", async () => {
    const client = new QueritClient({
      apiKey: TEST_KEY,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("fault filter abort", { status: 404 })),
    });

    await expect(client.contents({ urls: ["https://example.com"], format: "markdown", crawlTimeout: 10, extrasMeta: true }))
      .rejects.toMatchObject({
        status: 404,
        message: "Querit API request failed with HTTP 404: fault filter abort",
      });
  });

  it("rejects malformed JSON and malformed success payloads", async () => {
    const malformedJson = new QueritClient({
      apiKey: TEST_KEY,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse("not-json")),
    });
    await expect(malformedJson.search({ query: "pi", count: 1 })).rejects.toThrow("invalid JSON");

    const malformedPayload = new QueritClient({
      apiKey: TEST_KEY,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse('{"error_code":200,"search_id":8}')),
    });
    await expect(malformedPayload.search({ query: "pi", count: 1 })).rejects.toMatchObject({
      message: "Querit search response is missing results.result. [search_id: 8]",
      searchId: "8",
    });
  });

  it("rejects oversized responses before reading the body", async () => {
    const client = new QueritClient({
      apiKey: TEST_KEY,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("x", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(3 * 1024 * 1024) },
      })),
    });

    await expect(client.search({ query: "pi", count: 1 })).rejects.toThrow("response exceeds the 2097152-byte limit");
  });

  it("times out an unresponsive request without retrying", async () => {
    const fetchMock = hangingFetch();
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock, timeoutMs: 5 });

    await expect(client.search({ query: "pi", count: 1 })).rejects.toMatchObject({
      name: "QueritApiError",
      message: "Querit request timed out after 5 ms.",
      attempts: 1,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("forwards cancellation as a Querit cancellation error", async () => {
    const fetchMock = hangingFetch();
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock });
    const controller = new AbortController();
    const request = client.search({ query: "pi", count: 1 }, controller.signal);
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "QueritApiError", message: "Querit request was cancelled." });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("requires a non-empty API key", () => {
    expect(() => new QueritClient({ apiKey: "   " })).toThrow("API key is required");
  });

  it("honors a custom base URL and timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(success());
    const client = new QueritClient({ apiKey: TEST_KEY, fetchImpl: fetchMock, baseUrl: "https://proxy.example/", timeoutMs: 42_000 });
    await client.search({ query: "q" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://proxy.example/v1/search");
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
    const cost = (total: number): QueritCost => ({ currency: "USD", total });
    expect(formatCost(cost(0.000001))).toBe("USD 0.000001");
    expect(formatCost(cost(0))).toBe("USD 0.000000");
    expect(formatCost(cost(1.5))).toBe("USD 1.500000");
  });
});
