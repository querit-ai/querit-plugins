#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CLAUDE_PLUGIN_API_KEY_ENV, LOCAL_API_KEY_ENV } from "./config.js";
import { createQueritMcpServer } from "./mcp.js";
import { safeErrorMessage } from "./sanitize.js";

async function main(): Promise<void> {
  const server = createQueritMcpServer();
  await server.connect(new StdioServerTransport());
}

try {
  await main();
} catch (error) {
  const secrets = [
    process.env[CLAUDE_PLUGIN_API_KEY_ENV]?.trim(),
    process.env[LOCAL_API_KEY_ENV]?.trim(),
  ];
  process.stderr.write(`Querit MCP server failed to start: ${safeErrorMessage(error, secrets)}\n`);
  process.exitCode = 1;
}
