import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QueritApiError,
  QueritClient,
  formatCost,
  parseRetryAfter,
  type QueritRetryOptions,
} from "../src/client.js";

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
  const client = new QueritClient({ apiKey: "test-key", fetchImpl: fetchMock, retry });
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
  it("sends the documented search request and normalizes results", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(
      '{"error_code":200,"search_id":9007199254740993123,"query_context":{"query":"pi"},"results":{"result":[{"url":"https://example.com/a","title":"A","snippet":"one","sentence":["chunk"]},{"url":"https://example.com/a","title":"duplicate"},{"url":"javascript:alert(1)","title":"bad"}]}}',
    ));
    const client = new QueritClient({ apiKey: "test-key", fetchImpl: fetchMock });

    const result = await client.search({
      query: "pi",
      count: 5,
      needContent: true,
      chunksPerDoc: 1,
      filters: { sites: { include: ["example.com"] } },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.querit.ai/v1/search");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "pi",
      count: 5,
      needContent: true,
      chunksPerDoc: 1,
      filters: { sites: { include: ["example.com"] } },
    });
    expect(result.searchId).toBe("9007199254740993123");
    expect(result.cost).toBeUndefined();
    expect(result.results).toEqual([{
      title: "A",
      url: "https://example.com/a",
      snippet: "one",
      pageAge: undefined,
      siteName: undefined,
      siteIcon: undefined,
      sentences: ["chunk"],
      highlights: [],
      snippetMarkdown: undefined,
      contentMarkdown: undefined,
    }]);
  });

  it("forwards the newer search parameters untouched", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error_code: 200,
      results: { result: [] },
    }));
    const client = new QueritClient({ apiKey: "test-key", fetchImpl: fetchMock });

    await client.search({
      query: "asyncio semaphore",
      highlights: { query: "rate limiter", maxCharacters: 300 },
      needContent: true,
      contentMaxChars: 2_000,
      rank: { preference: "freshness" },
      filters: { vertical: "finance", resourceTags: { include: ["qa", "github"] } },
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      query: "asyncio semaphore",
      highlights: { query: "rate limiter", maxCharacters: 300 },
      needContent: true,
      contentMaxChars: 2_000,
      rank: { preference: "freshness" },
      filters: { vertical: "finance", resourceTags: { include: ["qa", "github"] } },
    });
  });

  it("reads cost, highlights, and Markdown fields, tolerating their absence", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(
      '{"error_code":200,"search_id":8,"took":"0.42","cost":{"currency":"USD","total":0.000123},"results":{"result":'
      + '[{"url":"https://example.com/a","title":"A","snippet":"one","highlights":["relevant fragment"],"snippet_markdown":["**one**"],"content_markdown":"# body"},'
      + '{"url":"https://example.com/b","title":"B"},{"url":"https://example.com/c","highlights":"not a list","cost":{"total":-1}}]}}',
    ));
    const client = new QueritClient({ apiKey: "test-key", fetchImpl: fetchMock });

    const result = await client.search({ query: "pi" });

    expect(result.cost).toEqual({ currency: "USD", total: 0.000123 });
    expect(result.took).toBe("0.42");
    expect(result.results.map((item) => [item.highlights, item.snippetMarkdown, item.contentMarkdown])).toEqual([
      [["relevant fragment"], ["**one**"], "# body"],
      [[], undefined, undefined],
      [[], undefined, undefined],
    ]);
  });

  it("sends the documented contents request and normalizes metadata", async () => {
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
    const client = new QueritClient({ apiKey: "test-key", fetchImpl: fetchMock });

    const result = await client.contents({
      urls: ["https://example.com"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
      contentMaxChars: 4_000,
      highlights: { maxCharacters: 2_000 },
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.querit.ai/v1/contents");
    expect(JSON.parse(String(init?.body))).toEqual({
      urls: ["https://example.com"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
      contentMaxChars: 4_000,
      highlights: { maxCharacters: 2_000 },
    });
    expect(result.cost).toEqual({ currency: "USD", total: 0 });
    expect(result.results[0]).toMatchObject({
      id: "a",
      url: "https://example.com/",
      content: "# Example",
      highlights: ["the fact"],
      metadata: { title: "Example", publishTime: "2026-01-01", siteName: "Example" },
    });
    expect(result.statuses).toEqual([{ id: "a", status: "success" }]);
  });

  it("throws a redacted API error that carries search_id for authentication failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error_code: "401",
      error_msg: "\u001b[31minvalid test-key\u001b[0m",
      search_id: 7,
    }, { status: 401 }));
    const client = new QueritClient({ apiKey: "test-key", fetchImpl: fetchMock });

    await expect(client.search({ query: "pi", count: 1 })).rejects.toMatchObject({
      name: "QueritApiError",
      status: 401,
      searchId: "7",
      attempts: 1,
      message: "invalid [REDACTED] [search_id: 7]",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("takes error_code as the verdict even on an HTTP 200, and retries only the transient codes", async () => {
    // Querit documents error_code as matching the HTTP status, and asks for it to be checked on a 200 too.
    const refused = fastRetryClient(jsonResponse({ error_code: 403, error_msg: "no Search API access", search_id: 9 }));
    await expect(refused.client.search({ query: "pi" })).rejects.toMatchObject({
      status: 403,
      attempts: 1,
      searchId: "9",
      message: "no Search API access [search_id: 9]",
    });
    expect(refused.fetchMock).toHaveBeenCalledOnce();

    const rateLimited = fastRetryClient(
      jsonResponse({ error_code: 429, error_msg: "rate limited", search_id: 10 }),
      jsonResponse({ error_code: 200, results: { result: [] } }),
    );
    await expect(rateLimited.client.search({ query: "pi" })).resolves.toMatchObject({ results: [] });
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

    const result = await client.search({ query: "pi" });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.results).toHaveLength(1);
  });

  it("gives up after the default budget of two retries and reports the attempt count", async () => {
    const { fetchMock, client } = fastRetryClient(transientFailure(503), transientFailure(503), transientFailure(503));

    const request = client.search({ query: "pi" });
    await expect(request).rejects.toMatchObject({
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
    const success = jsonResponse({ error_code: 200, results: { result: [] } });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(transientFailure(500))
      .mockResolvedValueOnce(success);
    const client = new QueritClient({
      apiKey: "test-key",
      fetchImpl: fetchMock,
      retry: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 100 },
    });

    const request = client.search({ query: "pi" });
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(51);
    await expect(request).resolves.toMatchObject({ results: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors a Retry-After that fits the wait budget", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const success = jsonResponse({ error_code: 200, results: { result: [] } });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(transientFailure(429, { "retry-after": "2" }))
      .mockResolvedValueOnce(success);
    const client = new QueritClient({
      apiKey: "test-key",
      fetchImpl: fetchMock,
      retry: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 3_000 },
    });

    const request = client.search({ query: "pi" });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toMatchObject({ results: [] });
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
      apiKey: "test-key",
      fetchImpl: fetchMock,
      retry: { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 1_000 },
    });
    const controller = new AbortController();

    const request = client.search({ query: "pi" }, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({
      name: "QueritApiError",
      message: "Querit request was cancelled.",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports non-JSON HTTP failures with their status", async () => {
    const client = new QueritClient({
      apiKey: "test-key",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("fault filter abort", { status: 404 })),
    });

    await expect(client.contents({
      urls: ["https://example.com"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
    })).rejects.toMatchObject({
      status: 404,
      message: "Querit API request failed with HTTP 404: fault filter abort",
    });
  });

  it("rejects malformed JSON and malformed success payloads", async () => {
    const malformedJson = new QueritClient({
      apiKey: "test-key",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse("not-json")),
    });
    await expect(malformedJson.search({ query: "pi", count: 1 })).rejects.toThrow("invalid JSON");

    const malformedPayload = new QueritClient({
      apiKey: "test-key",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error_code: 200 })),
    });
    await expect(malformedPayload.search({ query: "pi", count: 1 })).rejects.toThrow("results.result");
  });

  it("rejects oversized responses before reading the body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error_code: 200 }, {
      headers: { "content-type": "application/json", "content-length": String(3 * 1024 * 1024) },
    }));
    const client = new QueritClient({ apiKey: "test-key", fetchImpl: fetchMock });
    await expect(client.search({ query: "pi", count: 1 })).rejects.toThrow("response exceeds");
  });

  it("times out an unresponsive request without retrying", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const client = new QueritClient({ apiKey: "test-key", fetchImpl: fetchMock, timeoutMs: 5 });

    await expect(client.search({ query: "pi", count: 1 })).rejects.toMatchObject({
      name: "QueritApiError",
      message: "Querit request timed out after 5 ms.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("forwards cancellation as a Querit cancellation error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const client = new QueritClient({ apiKey: "test-key", fetchImpl: fetchMock });
    const controller = new AbortController();
    const request = client.search({ query: "pi", count: 1 }, controller.signal);
    controller.abort();

    await expect(request).rejects.toEqual(expect.objectContaining<Partial<QueritApiError>>({
      name: "QueritApiError",
      message: "Querit request was cancelled.",
    }));
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
    expect(formatCost({ currency: "USD", total: 1.5 })).toBe("USD 1.500000");
  });
});
