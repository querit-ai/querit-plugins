import { describe, expect, it, vi } from "vitest";
import { QueritApiError, QueritClient } from "../src/client.js";

function jsonResponse(body: string | object, init: ResponseInit = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

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
    expect(result.results).toEqual([{ 
      title: "A",
      url: "https://example.com/a",
      snippet: "one",
      pageAge: undefined,
      siteName: undefined,
      siteIcon: undefined,
      sentences: ["chunk"],
    }]);
  });

  it("sends the documented contents request and normalizes metadata", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error_code: 200,
      search_id: 42,
      results: [{
        id: "a",
        url: "https://example.com",
        content: "# Example",
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
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.querit.ai/v1/contents");
    expect(result.results[0]).toMatchObject({
      id: "a",
      url: "https://example.com/",
      content: "# Example",
      metadata: { title: "Example", publishTime: "2026-01-01", siteName: "Example" },
    });
    expect(result.statuses).toEqual([{ id: "a", status: "success" }]);
  });

  it("throws a redacted API error for authentication failures", async () => {
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
      message: "invalid [REDACTED]",
    });
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

  it("times out an unresponsive request", async () => {
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
