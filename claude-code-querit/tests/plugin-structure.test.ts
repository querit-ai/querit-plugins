import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_SERVER_VERSION } from "../src/mcp.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const pluginRoot = join(packageRoot, "plugin");

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("Claude Code plugin package", () => {
  it("has an optional sensitive api_key user option", async () => {
    const manifest = await json(join(pluginRoot, ".claude-plugin", "plugin.json"));
    const packageJson = await json(join(packageRoot, "package.json"));
    expect(manifest.version).toBe(packageJson.version);
    expect(MCP_SERVER_VERSION).toBe(packageJson.version);
    const userConfig = manifest.userConfig as Record<string, Record<string, unknown>>;
    expect(userConfig.api_key).toMatchObject({
      type: "string",
      required: false,
      sensitive: true,
    });
    expect(await readdir(join(pluginRoot, ".claude-plugin"))).toEqual(["plugin.json"]);
  });

  it("launches the committed bundle through plugin-relative MCP configuration", async () => {
    const mcp = await json(join(pluginRoot, ".mcp.json"));
    const server = (mcp.mcpServers as Record<string, Record<string, unknown>>).querit!;
    expect(server).toMatchObject({
      type: "stdio",
      command: "node",
      args: ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"],
      timeout: 90_000,
      env: {
        CLAUDE_PLUGIN_OPTION_API_KEY: "${user_config.api_key}",
      },
    });

    const bundle = await readFile(join(pluginRoot, "dist", "server.js"), "utf8");
    expect(bundle.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("contains one skill and no hook or agent components", async () => {
    expect(await readdir(join(pluginRoot, "skills"))).toEqual(["research"]);
    expect(await readdir(join(pluginRoot, "skills", "research"))).toEqual(["SKILL.md"]);
    await expect(readdir(join(pluginRoot, "hooks"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(join(pluginRoot, "agents"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps npm metadata out of the copied plugin root", async () => {
    for (const entry of ["package.json", "package-lock.json", "node_modules"]) {
      await expect(readdir(join(pluginRoot, entry))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});
