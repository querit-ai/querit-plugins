import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadQueritConfig,
  resolveQueritApiKey,
  saveQueritConfig,
} from "../src/config.js";

const temporaryDirectories: string[] = [];

async function temporaryConfigPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-querit-config-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "querit-search.json");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Querit configuration", () => {
  it("writes and reads a trimmed API key", async () => {
    const path = await temporaryConfigPath();
    await saveQueritConfig("  test-key  ", path);

    await expect(loadQueritConfig(path)).resolves.toEqual({ apiKey: "test-key" });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ apiKey: "test-key" });

    await saveQueritConfig("replacement-key", path);
    await expect(loadQueritConfig(path)).resolves.toEqual({ apiKey: "replacement-key" });
  });

  it("ignores removed summary settings from older configurations", async () => {
    const path = await temporaryConfigPath();
    await writeFile(path, JSON.stringify({
      apiKey: "key",
      defaultWorkflow: "summary",
      summaryModel: "provider/model-id",
      summaryThinkingLevel: "medium",
    }), "utf8");

    await expect(loadQueritConfig(path)).resolves.toEqual({ apiKey: "key" });
  });

  it("persists and sanitizes search defaults", async () => {
    const path = await temporaryConfigPath();
    await saveQueritConfig("test-key", path, {
      search: {
        count: 10,
        timeRange: "d7",
        includeContent: false,
        chunksPerDoc: 2,
        countries: ["united states"],
        languages: ["english"],
        includeDomains: ["GitHub.com"],
        excludeDomains: [],
      },
    });

    await expect(loadQueritConfig(path)).resolves.toEqual({
      apiKey: "test-key",
      search: {
        count: 10,
        timeRange: "d7",
        includeContent: false,
        chunksPerDoc: 2,
        countries: ["united states"],
        languages: ["english"],
        includeDomains: ["github.com"],
      },
    });

    await saveQueritConfig("test-key", path, { search: { count: 99 } });
    await expect(loadQueritConfig(path)).resolves.toEqual({ apiKey: "test-key" });
  });

  it("drops invalid search default fields when loading", async () => {
    const path = await temporaryConfigPath();
    await writeFile(path, JSON.stringify({
      apiKey: "key",
      search: {
        count: 99,
        chunksPerDoc: 0,
        timeRange: "  ",
        countries: ["atlantis"],
        languages: "english",
        includeDomains: ["ok.example", "bad domain", 42],
      },
    }), "utf8");

    await expect(loadQueritConfig(path)).resolves.toEqual({
      apiKey: "key",
      search: { includeDomains: ["ok.example"] },
    });
  });
  it("prefers the environment variable over the JSON configuration", async () => {
    const path = await temporaryConfigPath();
    await saveQueritConfig("json-key", path);

    await expect(resolveQueritApiKey({ configPath: path, env: { QUERIT_API_KEY: "env-key" } })).resolves.toBe("env-key");
  });

  it("uses the environment when the JSON file is absent", async () => {
    const path = await temporaryConfigPath();
    await expect(resolveQueritApiKey({ configPath: path, env: { QUERIT_API_KEY: " env-key " } })).resolves.toBe("env-key");
  });

  it("uses the JSON configuration when no environment key is set", async () => {
    const path = await temporaryConfigPath();
    await saveQueritConfig("json-key", path);

    await expect(resolveQueritApiKey({ configPath: path, env: {} })).resolves.toBe("json-key");
  });

  it("rejects malformed or empty configuration", async () => {
    const path = await temporaryConfigPath();
    await writeFile(path, "not-json", "utf8");
    await expect(loadQueritConfig(path)).rejects.toThrow("not valid JSON");

    await writeFile(path, JSON.stringify({ apiKey: "" }), "utf8");
    await expect(loadQueritConfig(path)).rejects.toThrow("non-empty");
  });

  it.runIf(process.platform !== "win32")("sets owner-only permissions on POSIX", async () => {
    const path = await temporaryConfigPath();
    await saveQueritConfig("test-key", path);
    await chmod(path, 0o600);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
