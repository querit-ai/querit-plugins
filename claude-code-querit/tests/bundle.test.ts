import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
let temporaryDirectory: string | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("committed MCP bundle", () => {
  it("starts from an isolated directory and lists both tools over stdio", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "claude-code-querit-"));
    const isolatedBundle = join(temporaryDirectory, "server.mjs");
    await copyFile(join(packageRoot, "plugin", "dist", "server.js"), isolatedBundle);

    const env: Record<string, string> = {
      CLAUDE_PLUGIN_OPTION_API_KEY: "test-api-key-placeholder",
    };
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [isolatedBundle],
      cwd: temporaryDirectory,
      env,
      stderr: "pipe",
    });
    client = new Client({ name: "bundle-smoke-test", version: "1.0.0" });
    await client.connect(transport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(["web_search", "fetch_content"]);
  }, 15_000);
});
