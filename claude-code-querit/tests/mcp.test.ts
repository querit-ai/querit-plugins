import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { QueritClient } from "../src/client.js";
import type { QueritClientLike } from "../src/tools.js";
import { createQueritMcpServer, TOOL_NAMES } from "../src/mcp.js";

const TEST_API_KEY = "test-api-key-placeholder";
let client: Client | undefined;
let server: McpServer | undefined;

afterEach(async () => {
  await client?.close();
  await server?.close();
  client = undefined;
  server = undefined;
});

async function connect(clientImplementation: QueritClientLike, env: NodeJS.ProcessEnv = {
  QUERIT_API_KEY: TEST_API_KEY,
}): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  server = createQueritMcpServer({ env, clientFactory: () => clientImplementation });
  await server.connect(serverTransport);

  client = new Client({ name: "querit-tests", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

/** The real client over a fake transport, with near-zero retry waits. */
function realClient(fetchImpl: typeof fetch): QueritClientLike {
  const real = new QueritClient({ apiKey: TEST_API_KEY, fetchImpl, retry: { baseDelayMs: 1, maxDelayMs: 1 } });
  return {
    search: (request, signal) => real.search(request, signal),
    contents: (request, signal) => real.contents(request, signal),
  };
}

function resultText(result: CallToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") throw new Error("Expected text content.");
  return first.text;
}

describe("Querit MCP server", () => {
  it("advertises exactly the two read-only tools", async () => {
    const connected = await connect({ search: vi.fn(), contents: vi.fn() });
    const listed = await connected.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    for (const tool of listed.tools) {
      expect(tool.description).toContain("untrusted web data");
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
      expect(tool.inputSchema.type).toBe("object");
    }

    const webSearch = listed.tools.find((tool) => tool.name === "web_search");
    expect(webSearch?.inputSchema.properties).toMatchObject({
      query: { type: "string" },
      count: { type: "integer", minimum: 1, maximum: 100 },
      highlights: { type: "boolean" },
      highlight_query: { type: "string" },
      highlight_max_chars: { type: "integer", minimum: 100, maximum: 8000 },
      need_content: { type: "boolean" },
      max_chars: { type: "integer", minimum: 1, maximum: 1_000_000 },
      need_markdown: { type: "boolean" },
      rank: { type: "string", enum: ["relevance", "freshness"] },
      vertical: { type: "string", enum: ["code", "finance"] },
    });
    expect(webSearch?.inputSchema.required).toEqual(["query"]);

    const fetchContent = listed.tools.find((tool) => tool.name === "fetch_content");
    expect(fetchContent?.inputSchema.properties).toMatchObject({
      urls: { type: "array", minItems: 1, maxItems: 10 },
      format: { type: "string" },
      crawl_timeout: { type: "integer" },
      include_metadata: { type: "boolean" },
      max_chars: { type: "integer", minimum: 1, maximum: 1_000_000 },
      highlight_query: { type: "string" },
      highlight_max_chars: { type: "integer", minimum: 100, maximum: 8000 },
    });
    expect(fetchContent?.inputSchema.required).toEqual(["urls"]);
  });

  it("dispatches web_search through the MCP protocol with the 1.0.0 arguments unchanged", async () => {
    const implementation: QueritClientLike = {
      search: vi.fn(async () => ({
        query: "MCP query",
        results: [{
          title: "MCP source",
          url: "https://example.com/source",
          snippet: "result",
          sentences: [],
          highlights: [],
        }],
      })),
      contents: vi.fn(),
    };
    const connected = await connect(implementation);

    const result = await connected.callTool({
      name: "web_search",
      arguments: { query: " MCP query ", count: 2 },
    }) as CallToolResult;

    expect(result.isError).not.toBe(true);
    expect(resultText(result)).toContain("MCP source");
    expect(implementation.search).toHaveBeenCalledWith(expect.objectContaining({
      query: "MCP query",
      count: 2,
    }), expect.any(AbortSignal));
  });

  it("passes the newer web_search options through the protocol", async () => {
    const implementation: QueritClientLike = {
      search: vi.fn(async () => ({
        query: "semaphore",
        results: [{ title: "Source", url: "https://example.com/source", snippet: "result", sentences: [], highlights: [] }],
      })),
      contents: vi.fn(),
    };
    const connected = await connect(implementation);

    const result = await connected.callTool({
      name: "web_search",
      arguments: { query: "semaphore", highlights: true, rank: "freshness", vertical: "finance", need_content: true, max_chars: 3000 },
    }) as CallToolResult;

    expect(result.isError).not.toBe(true);
    expect(implementation.search).toHaveBeenCalledWith({
      query: "semaphore",
      highlights: { query: "semaphore" },
      needContent: true,
      contentMaxChars: 3000,
      rank: { preference: "freshness" },
      filters: { vertical: "finance" },
    }, expect.any(AbortSignal));
  });

  it("rejects out-of-range web_search arguments before the handler runs", async () => {
    const implementation: QueritClientLike = { search: vi.fn(), contents: vi.fn() };
    const connected = await connect(implementation);

    for (const arguments_ of [{ query: "q", count: 101 }, { query: "q", count: 0 }, { query: "q", rank: "popular" }, { query: "   " }]) {
      const result = await connected.callTool({ name: "web_search", arguments: arguments_ }) as CallToolResult;
      expect(result.isError).toBe(true);
    }
    expect(implementation.search).not.toHaveBeenCalled();
  });

  it("dispatches fetch_content and reports URL validation as a tool error", async () => {
    const implementation: QueritClientLike = {
      search: vi.fn(),
      contents: vi.fn(async () => ({ results: [], statuses: [] })),
    };
    const connected = await connect(implementation);

    const valid = await connected.callTool({
      name: "fetch_content",
      arguments: { urls: ["https://example.com/page"], format: "text" },
    }) as CallToolResult;
    expect(valid.isError).not.toBe(true);
    expect(implementation.contents).toHaveBeenCalledWith(expect.objectContaining({
      urls: ["https://example.com/page"],
      format: "text",
    }), expect.any(AbortSignal));

    const invalid = await connected.callTool({
      name: "fetch_content",
      arguments: { urls: ["file:///tmp/page"] },
    }) as CallToolResult;
    expect(invalid.isError).toBe(true);
    expect(resultText(invalid)).toContain("only HTTP(S) URLs");
  });

  it("passes the newer fetch_content options through the protocol", async () => {
    const implementation: QueritClientLike = {
      search: vi.fn(),
      contents: vi.fn(async () => ({ results: [], statuses: [] })),
    };
    const connected = await connect(implementation);

    const limited = await connected.callTool({
      name: "fetch_content",
      arguments: { urls: ["https://example.com/page"], max_chars: 20000, highlight_query: "breaking change" },
    }) as CallToolResult;
    expect(limited.isError).not.toBe(true);
    expect(implementation.contents).toHaveBeenCalledWith({
      urls: ["https://example.com/page"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
      contentMaxChars: 20000,
      highlights: { query: "breaking change" },
    }, expect.any(AbortSignal));

    const invalid = await connected.callTool({
      name: "fetch_content",
      arguments: { urls: ["https://example.com/page"], max_chars: 0 },
    }) as CallToolResult;
    expect(invalid.isError).toBe(true);
    expect(implementation.contents).toHaveBeenCalledOnce();
  });

  it("retries a transient failure end to end and shows the reported cost", async () => {
    const responses = [
      new Response(JSON.stringify({ error_code: 503, error_msg: "upstream busy", search_id: 5 }), {
        status: 503,
        headers: { "retry-after": "0" },
      }),
      new Response(JSON.stringify({
        search_id: 5,
        cost: { currency: "USD", total: 0.000123 },
        results: {
          result: [{ url: "https://example.com/source", title: "Source", snippet: "result", highlights: ["focused text"] }],
        },
      })),
    ];
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.querit.ai/v1/search");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TEST_API_KEY}`);
      bodies.push(JSON.parse(String(init?.body)));
      return responses.shift()!;
    }) as unknown as typeof fetch;
    const connected = await connect(realClient(fetchImpl));

    const result = await connected.callTool({
      name: "web_search",
      arguments: { query: "semaphore", highlights: true },
    }) as CallToolResult;

    expect(result.isError).not.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(bodies).toEqual([
      { query: "semaphore", highlights: { query: "semaphore" } },
      { query: "semaphore", highlights: { query: "semaphore" } },
    ]);
    expect(resultText(result)).toContain("Search ID: 5 | Cost: USD 0.000123");
    expect(resultText(result)).toContain("- focused text");
  });

  it("reports search_id and the attempt count once retries are exhausted", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error_code: 429,
      error_msg: "rate limited",
      search_id: 11,
    }), { status: 429 })) as unknown as typeof fetch;
    const connected = await connect(realClient(fetchImpl));

    const result = await connected.callTool({ name: "web_search", arguments: { query: "test" } }) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(
      "Querit tool error: Querit request failed after 3 attempts: rate limited [search_id: 11]",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 403 from contents and still reports its search_id", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error_code: 403,
      error_msg: "no Contents subscription",
      search_id: 3,
    }), { status: 403 })) as unknown as typeof fetch;
    const connected = await connect(realClient(fetchImpl));

    const result = await connected.callTool({
      name: "fetch_content",
      arguments: { urls: ["https://example.com/page"] },
    }) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe("Querit tool error: no Contents subscription [search_id: 3]");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps the server available but returns a configuration error without a key", async () => {
    const connected = await connect({ search: vi.fn(), contents: vi.fn() }, {});
    const result = await connected.callTool({
      name: "web_search",
      arguments: { query: "test" },
    }) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("Querit is not configured");
  });
});
