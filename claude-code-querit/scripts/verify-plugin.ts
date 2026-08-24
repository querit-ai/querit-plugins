import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const pluginRoot = join(packageRoot, "plugin");

const packageJson = await readJson(join(packageRoot, "package.json"));
const manifest = await readJson(join(pluginRoot, ".claude-plugin", "plugin.json"));
const mcp = await readJson(join(pluginRoot, ".mcp.json"));

assert.equal(packageJson.name, "claude-code-querit");
assert.equal(manifest.name, "querit-ai");
assert.equal(manifest.version, packageJson.version, "Manifest and package versions must match.");

const userConfig = record(manifest.userConfig, "plugin.json userConfig");
const apiKey = record(userConfig.api_key, "plugin.json userConfig.api_key");
assert.equal(apiKey.type, "string");
assert.equal(apiKey.required, true);
assert.equal(apiKey.sensitive, true);

const mcpServers = record(mcp.mcpServers, ".mcp.json mcpServers");
const queritServer = record(mcpServers.querit, ".mcp.json mcpServers.querit");
assert.equal(queritServer.type, "stdio");
assert.equal(queritServer.command, "node");
assert.deepEqual(queritServer.args, ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"]);
assert.equal(record(queritServer.env, ".mcp.json server env").CLAUDE_PLUGIN_OPTION_API_KEY, "${user_config.api_key}");
assert.equal(queritServer.timeout, 90_000);

const pluginEntries = await readdir(join(pluginRoot, ".claude-plugin"));
assert.deepEqual(pluginEntries, ["plugin.json"], "Only plugin.json belongs in .claude-plugin/.");

const skills = await findNamedFiles(join(pluginRoot, "skills"), "SKILL.md");
assert.equal(skills.length, 1, "The plugin must contain exactly one skill.");
await assertMissing(join(pluginRoot, "hooks"));
await assertMissing(join(pluginRoot, "agents"));

// Claude Code runs `npm ci` inside a copied plugin that has both a package.json and a
// lockfile. Keeping both out of plugin/ is what stops installs from pulling dev tooling.
await assertMissing(join(pluginRoot, "package.json"));
await assertMissing(join(pluginRoot, "package-lock.json"));
await assertMissing(join(pluginRoot, "node_modules"));

const bundlePath = join(pluginRoot, "dist", "server.js");
const bundle = await readFile(bundlePath, "utf8");
assert.ok(bundle.startsWith("#!/usr/bin/env node"));
assert.ok(bundle.length > 10_000, "dist/server.js does not look like a bundled MCP server.");
execFileSync(process.execPath, ["--check", bundlePath], { stdio: "pipe" });

const publishedFiles = packageJson.files;
assert.ok(Array.isArray(publishedFiles));
for (const requiredPath of ["plugin", "README.md", "LICENSE"]) {
  assert.ok(publishedFiles.includes(requiredPath), `package.json files is missing ${requiredPath}.`);
}

process.stdout.write("Claude Code plugin structure verified.\n");

async function readJson(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return record(parsed, path);
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${label} must be an object.`);
  return value as Record<string, unknown>;
}

async function findNamedFiles(directory: string, name: string): Promise<string[]> {
  const matches: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await findNamedFiles(path, name));
    if (entry.isFile() && entry.name === name) matches.push(path);
  }
  return matches;
}

async function assertMissing(path: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch {
    return;
  }
  assert.fail(`Unexpected plugin component: ${path}`);
}
