import { describe, expect, it, vi } from "vitest";
import { QueritSearchAdapter } from "../src/querit.js";

function jsonResponse(body: object | string, init: ResponseInit = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

describe("QueritSearchAdapter", () => {
  it("sends the documented search request and retains citation fields", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(
      "{\"error_code\":200,\"search_id\":9007199254740993123,\"query_context\":{\"query\":\"browser docs\"},\"results\":{\"result\":[{\"title\":\"Docs\",\"url\":\"https://example.com/docs\",\"snippet\":\"Official docs\",\"sentence\":[\"Citation passage\"],\"site_name\":\"Example\",\"page_age\":\"2026-08-01\"}]}}",
    ));
    const adapter = new QueritSearchAdapter({ apiKey: "test-key", fetchImpl: fetchMock });

    const response = await adapter.search("browser docs");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.querit.ai/v1/search");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "browser docs",
      count: 5,
      chunksPerDoc: 1,
      needContent: true,
    });
    expect(response).toEqual({
      query: "browser docs",
      searchId: "9007199254740993123",
      results: [{
        passages: ["Citation passage"],
        publishedAt: "2026-08-01",
        siteName: "Example",
        snippet: "Official docs",
        title: "Docs",
        url: "https://example.com/docs",
      }],
    });
  });

  it("returns an empty result list without touching Browserbase concerns", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error_code: 200,
      query_context: { query: "nothing" },
      results: { result: [] },
      search_id: 12,
    }));
    const adapter = new QueritSearchAdapter({ apiKey: "test-key", fetchImpl: fetchMock });

    await expect(adapter.search("nothing")).resolves.toMatchObject({ results: [] });
  });

  it("redacts the API key from structured API failures", async () => {
    const apiKey = "querit-secret-key";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error_code: "401",
      error_msg: `\u001b[31minvalid ${apiKey}\u001b[0m`,
      search_id: 7,
    }, { status: 401 }));
    const adapter = new QueritSearchAdapter({ apiKey, fetchImpl: fetchMock });

    const error = await adapter.search("browser docs").catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "QUERIT_API_ERROR",
      name: "QueritApiError",
      searchId: "7",
      status: 401,
      message: "invalid [REDACTED]",
    });
    expect(String(error)).not.toContain(apiKey);
  });

  it("redacts the API key from network errors", async () => {
    const apiKey = "querit-secret-key";
    const adapter = new QueritSearchAdapter({
      apiKey,
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error(`connection failed: ${apiKey}`)),
    });

    await expect(adapter.search("browser docs")).rejects.toMatchObject({
      message: "Querit search request failed: connection failed: [REDACTED]",
    });
  });

  it("rejects malformed success payloads", async () => {
    const adapter = new QueritSearchAdapter({
      apiKey: "test-key",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error_code: 200 })),
    });

    await expect(adapter.search("browser docs")).rejects.toThrow("results.result");
  });
});
