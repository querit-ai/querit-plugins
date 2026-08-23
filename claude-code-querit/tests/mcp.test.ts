import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
  CLAUDE_PLUGIN_OPTION_API_KEY: TEST_API_KEY,
}): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  server = createQueritMcpServer({ env, clientFactory: () => clientImplementation });
  await server.connect(serverTransport);

  client = new Client({ name: "querit-tests", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
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
      count: { type: "integer" },
    });
    expect(webSearch?.inputSchema.required).toContain("query");

    const fetchContent = listed.tools.find((tool) => tool.name === "fetch_content");
    expect(fetchContent?.inputSchema.properties).toMatchObject({
      urls: { type: "array", minItems: 1, maxItems: 10 },
      format: { type: "string" },
      crawl_timeout: { type: "integer" },
      include_metadata: { type: "boolean" },
    });
    expect(fetchContent?.inputSchema.required).toContain("urls");
  });

  it("dispatches web_search through the MCP protocol", async () => {
    const implementation: QueritClientLike = {
      search: vi.fn(async () => ({
        query: "MCP query",
        results: [{
          title: "MCP source",
          url: "https://example.com/source",
          snippet: "result",
          sentences: [],
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
