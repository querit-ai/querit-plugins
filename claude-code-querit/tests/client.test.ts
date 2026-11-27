import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  QUERIT_API_BASE_URL,
  QueritApiError,
  QueritClient,
  formatCost,
  parseRetryAfter,
  type QueritRetryOptions,
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

function transientFailure(status: number, headers: Record<string, string> = {}): Response {
  return jsonResponse({ error_code: status, error_msg: `transient ${status}`, search_id: 5 }, status, headers);
}

/**
 * Near-zero waits, so retry logic is exercised without slowing the suite.
 * A Response body can be read once, so every attempt must get its own.
 */
function retryingClient(
  retry: Partial<QueritRetryOptions>,
  ...responses: Response[]
): { fetchImpl: FetchImpl; client: QueritClient } {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => {
    const response = queue.shift();
    if (!response) throw new Error("the test ran out of queued responses");
    return response;
  }) as unknown as FetchImpl;
  const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl, retry });
  return { fetchImpl, client };
}

/** The default retry budget (two retries) with near-zero waits. */
function fastRetryClient(...responses: Response[]) {
  return retryingClient({ baseDelayMs: 1, maxDelayMs: 2 }, ...responses);
}

/** Never answers unless its signal aborts, which is how a fetch times out or is cancelled. */
function hangingFetch(): { fetchImpl: FetchImpl; state: { calls: number } } {
  const state = { calls: 0 };
  const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    state.calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  }) as unknown as FetchImpl;
  return { fetchImpl, state };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("QueritClient requests", () => {
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

  it("sends only the query when no count was chosen and never adds chunksPerDoc", async () => {
    const { fetchImpl, calls } = capturingFetch();
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

    await client.search({ query: "test query" });

    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ query: "test query" });
  });

  it("forwards highlights, body text, ranking, and vertical untouched", async () => {
    const { fetchImpl, calls } = capturingFetch();
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

    await client.search({
      query: "asyncio semaphore",
      highlights: { query: "rate limiter", maxCharacters: 300 },
      needContent: true,
      contentMaxChars: 2_000,
      needMarkdown: true,
      rank: { preference: "freshness" },
      filters: { vertical: "finance" },
    });

    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      query: "asyncio semaphore",
      highlights: { query: "rate limiter", maxCharacters: 300 },
      needContent: true,
      contentMaxChars: 2_000,
      needMarkdown: true,
      rank: { preference: "freshness" },
      filters: { vertical: "finance" },
    });
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

  it("forwards contentMaxChars and highlights on contents requests", async () => {
    const { fetchImpl, calls } = capturingFetch();
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

    await client.contents({
      urls: ["https://example.com/page"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
      contentMaxChars: 4_000,
      highlights: { query: "release notes", maxCharacters: 2_000 },
    });

    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      urls: ["https://example.com/page"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
      contentMaxChars: 4_000,
      highlights: { query: "release notes", maxCharacters: 2_000 },
    });
  });
});

describe("QueritClient responses", () => {
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
        highlights: [],
      }],
    });
  });

  it("reads cost, highlights, and Markdown fields, tolerating their absence", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      search_id: 8,
      cost: { currency: "USD", total: 0.000123 },
      results: {
        result: [
          {
            url: "https://example.com/a",
            title: "A",
            snippet: "one",
            highlights: ["relevant fragment", 7],
            snippet_markdown: ["**one**"],
            content_markdown: "# body",
          },
          { url: "https://example.com/b", title: "B", highlights: "not a list" },
        ],
      },
    })) as unknown as FetchImpl;
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

    const result = await client.search({ query: "test" });

    expect(result.cost).toEqual({ currency: "USD", total: 0.000123 });
    expect(result.results.map((item) => [item.highlights, item.snippetMarkdown, item.contentMarkdown])).toEqual([
      [["relevant fragment"], ["**one**"], "# body"],
      [[], undefined, undefined],
    ]);
  });

  it("keeps an absent cost distinct from a reported zero", async () => {
    const costClient = async (cost: unknown) => {
      const fetchImpl = vi.fn(async () => jsonResponse({ search_id: 42, cost, results: { result: [] } })) as unknown as FetchImpl;
      return (await new QueritClient({ apiKey: TEST_API_KEY, fetchImpl }).search({ query: "test" })).cost;
    };

    expect(await costClient(undefined)).toBeUndefined();
    expect(await costClient({ currency: "USD", total: 0 })).toEqual({ currency: "USD", total: 0 });
    expect(await costClient({ currency: "USD", total: -1 })).toBeUndefined();
    expect(await costClient({ total: 0.5 })).toBeUndefined();
  });

  it("normalizes contents, statuses, highlights, and metadata", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      search_id: 7,
      cost: { currency: "USD", total: 0.01 },
      results: [
        {
          id: "1",
          url: "https://example.com/a",
          content: "hello",
          highlights: ["the fact"],
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
    expect(response.cost).toEqual({ currency: "USD", total: 0.01 });
    expect(response.results).toEqual([{
      id: "1",
      url: "https://example.com/a",
      content: "hello",
      highlights: ["the fact"],
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
});

describe("QueritClient failures", () => {
  it("redacts and sanitizes API error messages and carries search_id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      error_code: "401",
      error_msg: `invalid key ${TEST_API_KEY} \u001b[31mrejected\u001b[0m`,
      search_id: 7,
    }, 401)) as unknown as FetchImpl;
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

    await expect(client.search({ query: "q", count: 1 })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(QueritApiError);
      const apiError = error as QueritApiError;
      expect(apiError.message).toBe("invalid key [REDACTED] rejected [search_id: 7]");
      expect(apiError.message).not.toContain(TEST_API_KEY);
      expect(apiError.message).not.toContain("\u001b");
      expect(apiError.status).toBe(401);
      expect(apiError.searchId).toBe("7");
      return true;
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
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

  it("reads the verdict from error_code even on an HTTP 200, retrying only the transient codes", async () => {
    // Querit documents error_code as matching the HTTP status, and asks for it to be checked on a 200 too.
    const success = jsonResponse({ error_code: 200, results: { result: [] } });
    const rateLimited = fastRetryClient(
      jsonResponse({ error_code: "429", error_msg: "rate limited", search_id: 9 }),
      success,
    );
    await expect(rateLimited.client.search({ query: "q" })).resolves.toMatchObject({ results: [] });
    expect(rateLimited.fetchImpl).toHaveBeenCalledTimes(2);

    const badRequest = fastRetryClient(jsonResponse({ error_code: "400", error_msg: "bad parameter", search_id: 10 }));
    await expect(badRequest.client.search({ query: "q" })).rejects.toMatchObject({
      message: "bad parameter [search_id: 10]",
      status: 400,
      attempts: 1,
    });
    expect(badRequest.fetchImpl).toHaveBeenCalledOnce();
  });

  it("puts search_id from a malformed body into the failure message", async () => {
    const invalidJson = vi.fn(async () => new Response('{"search_id": 12, "took": ')) as unknown as FetchImpl;
    await expect(new QueritClient({ apiKey: TEST_API_KEY, fetchImpl: invalidJson }).search({ query: "q" }))
      .rejects.toMatchObject({ message: expect.stringContaining("invalid JSON"), searchId: "12" });

    const malformed = vi.fn(async () => jsonResponse({ error_code: 200, search_id: 5 })) as unknown as FetchImpl;
    await expect(new QueritClient({ apiKey: TEST_API_KEY, fetchImpl: malformed }).search({ query: "q" }))
      .rejects.toMatchObject({
        message: "Querit search response is missing results.result. [search_id: 5]",
        searchId: "5",
      });
  });

  it("reports non-JSON HTTP failures with their status", async () => {
    const fetchImpl = vi.fn(async () => new Response("fault filter abort", { status: 404 })) as unknown as FetchImpl;
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });

    await expect(client.contents({
      urls: ["https://example.com"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
    })).rejects.toMatchObject({ status: 404, message: "Querit API request failed with HTTP 404: fault filter abort" });
    expect(fetchImpl).toHaveBeenCalledOnce();
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

  it("ends every failure that carries a search_id with it", async () => {
    const responses = [
      transientFailure(503),
      new Response('{"search_id": 6, "error": "gateway"', { status: 500 }),
      jsonResponse({ error_code: 200, search_id: 4 }),
      jsonResponse([{ search_id: 3 }]),
    ];
    for (const response of responses) {
      const client = new QueritClient({
        apiKey: TEST_API_KEY,
        fetchImpl: vi.fn(async () => response) as unknown as FetchImpl,
        retry: { maxRetries: 0 },
      });
      const request = client.search({ query: "test" });
      await expect(request).rejects.toSatisfy((error: unknown) => {
        const apiError = error as QueritApiError;
        expect(apiError.message).toMatch(/\[search_id: -?\d+\]$/u);
        expect(apiError.message.endsWith(`[search_id: ${String(apiError.searchId)}]`)).toBe(true);
        return true;
      });
    }
  });

  it("validates credentials, base URLs, timeout, and retry options", () => {
    expect(() => new QueritClient({ apiKey: "   " })).toThrow("API key is required");
    expect(() => new QueritClient({ apiKey: TEST_API_KEY, baseUrl: "file:///tmp/api" })).toThrow("HTTP(S)");
    expect(() => new QueritClient({ apiKey: TEST_API_KEY, baseUrl: "https://user:pass@example.com" })).toThrow("credentials");
    expect(() => new QueritClient({ apiKey: TEST_API_KEY, timeoutMs: 999 })).toThrow("at least 1000");
    expect(() => new QueritClient({ apiKey: TEST_API_KEY, retry: { maxRetries: -1 } })).toThrow("retry options");
    expect(() => new QueritClient({ apiKey: TEST_API_KEY, retry: { baseDelayMs: Number.NaN } })).toThrow("retry options");
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(70_000);
  });
});

describe("QueritClient retries", () => {
  it("retries 429, 500, and 503 with backoff until a request succeeds", async () => {
    const success = jsonResponse({ error_code: 200, results: { result: [{ url: "https://example.com/" }] } });
    const { fetchImpl, client } = retryingClient(
      { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2 },
      transientFailure(429),
      transientFailure(500),
      transientFailure(503),
      success,
    );

    const result = await client.search({ query: "test" });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(result.results).toHaveLength(1);
  });

  it("retries transient contents failures the same way", async () => {
    const success = jsonResponse({ results: [], statuses: [] });
    const { fetchImpl, client } = fastRetryClient(transientFailure(503), success);

    const response = await client.contents({ urls: ["https://example.com"], format: "text", crawlTimeout: 10, extrasMeta: false });

    expect(response.results).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after the default budget of two retries and reports the attempt count", async () => {
    const { fetchImpl, client } = fastRetryClient(transientFailure(503), transientFailure(503), transientFailure(503));

    const request = client.search({ query: "test" });
    await expect(request).rejects.toMatchObject({
      name: "QueritApiError",
      status: 503,
      searchId: "5",
      attempts: 3,
      message: "Querit request failed after 3 attempts: transient 503 [search_id: 5]",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("never retries 400, 401, 403, or 404", async () => {
    for (const status of [400, 401, 403, 404]) {
      const { fetchImpl, client } = fastRetryClient(transientFailure(status));
      await expect(client.search({ query: "test" })).rejects.toMatchObject({ status, attempts: 1 });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it("does not retry when retries are disabled", async () => {
    const { fetchImpl, client } = retryingClient({ maxRetries: 0 }, transientFailure(503));

    await expect(client.search({ query: "test" })).rejects.toMatchObject({ status: 503, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("waits for a bounded, jittered backoff between attempts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const responses = [transientFailure(500), jsonResponse({ results: { result: [] } })];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as FetchImpl;
    const client = new QueritClient({
      apiKey: TEST_API_KEY,
      fetchImpl,
      retry: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 100 },
    });

    const request = client.search({ query: "test" });
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(51);
    await expect(request).resolves.toMatchObject({ results: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("honors a Retry-After that fits the wait budget", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const responses = [
      transientFailure(429, { "retry-after": "2" }),
      jsonResponse({ results: { result: [] } }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as FetchImpl;
    const client = new QueritClient({
      apiKey: TEST_API_KEY,
      fetchImpl,
      retry: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 3_000 },
    });

    const request = client.search({ query: "test" });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toMatchObject({ results: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("honors an HTTP-date Retry-After", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    // HTTP-dates have one-second precision, so the wait lands between 3 and 4 seconds out.
    const responses = [
      transientFailure(503, { "retry-after": new Date(Math.ceil(Date.now() / 1_000) * 1_000 + 3_000).toUTCString() }),
      jsonResponse({ results: { result: [] } }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as FetchImpl;
    const client = new QueritClient({
      apiKey: TEST_API_KEY,
      fetchImpl,
      retry: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 5_000 },
    });

    const request = client.search({ query: "test" });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(request).resolves.toMatchObject({ results: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not wait out a Retry-After longer than the budget", async () => {
    const { fetchImpl, client } = fastRetryClient(transientFailure(429, { "retry-after": "30" }));

    await expect(client.search({ query: "test" })).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 30_000,
      attempts: 1,
      message: "transient 429 Querit asked to retry after 30s, longer than the 2 ms this client waits; not retried. [search_id: 5]",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("stops retrying when the caller cancels during the backoff wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchImpl = vi.fn(async () => transientFailure(503)) as unknown as FetchImpl;
    const client = new QueritClient({
      apiKey: TEST_API_KEY,
      fetchImpl,
      retry: { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 1_000 },
    });
    const controller = new AbortController();

    const request = client.search({ query: "test" }, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({
      name: "QueritApiError",
      message: "Querit request was cancelled.",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("times out an unresponsive request without retrying", async () => {
    const { fetchImpl, state } = hangingFetch();
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl, timeoutMs: 1_000 });

    await expect(client.search({ query: "test" })).rejects.toMatchObject({
      name: "QueritApiError",
      message: "Querit request timed out after 1000 ms.",
      attempts: 1,
    });
    expect(state.calls).toBe(1);
  }, 10_000);

  it("forwards cancellation as a Querit cancellation error", async () => {
    const { fetchImpl, state } = hangingFetch();
    const client = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl });
    const controller = new AbortController();
    const request = client.search({ query: "test" }, controller.signal);
    controller.abort();

    await expect(request).rejects.toMatchObject({
      name: "QueritApiError",
      message: "Querit request was cancelled.",
    });
    expect(state.calls).toBe(1);
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
