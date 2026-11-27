import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  QueritContentsRequest,
  QueritSearchRequest,
} from "../src/client.js";
import type { QueritConfigSettings } from "../src/config.js";
import { registerQueritExtension } from "../src/index.js";

interface RegisteredTool {
  name: string;
  parameters: unknown;
  annotations?: unknown;
  execute: (...args: any[]) => Promise<any>;
}

interface RegisteredCommand {
  handler: (...args: any[]) => Promise<void>;
}

const temporaryDirectories: string[] = [];

async function createHarness(options: {
  search?: (request: QueritSearchRequest) => Promise<any>;
  contents?: (request: QueritContentsRequest) => Promise<any>;
  withConfig?: boolean;
  configSettings?: QueritConfigSettings;
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "pi-querit-extension-test-"));
  temporaryDirectories.push(directory);
  const configPath = join(directory, "querit-search.json");
  if (options.withConfig !== false) {
    await import("../src/config.js").then(({ saveQueritConfig }) =>
      saveQueritConfig("test-key", configPath, options.configSettings),
    );
  }

  const tools = new Map<string, RegisteredTool>();
  const commands = new Map<string, RegisteredCommand>();
  const pi = {
    registerTool(tool: RegisteredTool) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: RegisteredCommand) { commands.set(name, command); },
    on: vi.fn(),
  } as unknown as ExtensionAPI;

  const search = vi.fn(options.search ?? (async (request: QueritSearchRequest) => ({
    query: request.query,
    searchId: "1",
    results: [{ title: "Example", url: "https://example.com/", snippet: "Snippet", sentences: [], highlights: [] }],
  })));
  const contents = vi.fn(options.contents ?? (async () => ({
    searchId: "2",
    results: [{ url: "https://example.com/", content: "Body", highlights: [] }],
    statuses: [{ id: "1", status: "success" }],
  })));

  registerQueritExtension(pi, {
    configPath,
    env: {},
    clientFactory: () => ({ search, contents }),
  });

  return { tools, commands, search, contents, configPath, pi };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Pi extension", () => {
  it("registers the standard search/content tools and setup command", async () => {
    const harness = await createHarness();
    expect([...harness.tools.keys()]).toEqual(["web_search", "fetch_content"]);
    expect([...harness.commands.keys()]).toEqual(["querit-setup"]);
  });

  it("merges configured search defaults into the Querit request", async () => {
    const harness = await createHarness({
      configSettings: {
        search: {
          count: 10,
          timeRange: "m3",
          includeContent: true,
          contentMaxChars: 1_500,
          highlights: true,
          needMarkdown: true,
          rank: "freshness",
          chunksPerDoc: 1,
          countries: ["united states"],
          languages: ["english"],
          includeDomains: ["example.com"],
          excludeDomains: ["spam.example"],
        },
      },
    });
    const tool = harness.tools.get("web_search")!;
    const result = await tool.execute("call", { query: " pi " }, undefined, vi.fn(), {});

    expect(harness.search).toHaveBeenCalledWith({
      query: "pi",
      count: 10,
      chunksPerDoc: 1,
      highlights: true,
      needContent: true,
      contentMaxChars: 1_500,
      needMarkdown: true,
      rank: { preference: "freshness" },
      filters: {
        sites: { include: ["example.com"], exclude: ["spam.example"] },
        timeRange: { date: "m3" },
        geo: { countries: { include: ["united states"] } },
        languages: { include: ["english"] },
      },
    }, undefined);
    expect(result.content[0].text).toContain("https://example.com/");
    expect(result.details.sources).toEqual([{ title: "Example", url: "https://example.com/" }]);

    await tool.execute("call", { query: "pi", count: 3 }, undefined, vi.fn(), {});
    expect(harness.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "pi", count: 3 }),
      undefined,
    );
  });

  it("routes vertical searches per call and drops rank for the code vertical", async () => {
    const harness = await createHarness({ configSettings: { search: { count: 10, rank: "freshness" } } });
    const tool = harness.tools.get("web_search")!;

    await tool.execute("call", { query: "export policy" }, undefined, vi.fn(), {});
    expect(harness.search).toHaveBeenLastCalledWith(
      { query: "export policy", count: 10, rank: { preference: "freshness" } },
      undefined,
    );

    await tool.execute("call", { query: "asyncio semaphore", vertical: "code", count: 30 }, undefined, vi.fn(), {});
    expect(harness.search).toHaveBeenLastCalledWith(
      { query: "asyncio semaphore", count: 30, filters: { vertical: "code" } },
      undefined,
    );

    await tool.execute("call", { query: "rate hikes", vertical: "finance" }, undefined, vi.fn(), {});
    expect(harness.search).toHaveBeenLastCalledWith(
      { query: "rate hikes", count: 10, filters: { vertical: "finance" } },
      undefined,
    );
  });

  it("declares the documented parameter bounds and read-only annotations", async () => {
    const harness = await createHarness();
    const search = harness.tools.get("web_search")!.parameters as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(search.properties.count).toMatchObject({ type: "integer", minimum: 1, maximum: 100 });
    expect(search.properties.vertical).toMatchObject({ type: "string", enum: ["code", "finance"] });

    const contents = harness.tools.get("fetch_content")!.parameters as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(contents.properties.max_chars).toMatchObject({ type: "integer", minimum: 1, maximum: 1_000_000 });
    expect(contents.properties.highlight_max_chars).toMatchObject({ type: "integer", minimum: 100, maximum: 8_000 });
    expect(contents.properties.format).toMatchObject({ type: "string", enum: ["text", "markdown", "html"] });

    for (const name of ["web_search", "fetch_content"]) {
      expect(harness.tools.get(name)!.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
    }
  });

  it("reports Querit's per-request cost alongside the results", async () => {
    const harness = await createHarness({
      search: async (request) => ({
        query: request.query,
        searchId: "1",
        took: "0.3",
        cost: { currency: "USD", total: 0.000123 },
        results: [{ title: "Example", url: "https://example.com/", snippet: "Snippet", sentences: [], highlights: [] }],
      }),
    });
    const tool = harness.tools.get("web_search")!;

    const result = await tool.execute("call", { query: "pi" }, undefined, vi.fn(), {});

    expect(result.details.cost).toBe("USD 0.000123");
    expect(result.content[0].text).toContain("| Cost: USD 0.000123");
    expect(JSON.parse(JSON.stringify(result.details))).toEqual(result.details);
  });

  it("registers a session_shutdown handler that cleans up temp files", async () => {
    const harness = await createHarness();
    expect(harness.pi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
  });

  it("deduplicates and validates fetch_content URLs", async () => {
    const harness = await createHarness();
    const tool = harness.tools.get("fetch_content")!;
    await tool.execute("call", {
      url: "https://example.com",
      urls: ["https://example.com/"],
      format: "text",
      crawl_timeout: 20,
      include_metadata: false,
    }, undefined, vi.fn(), {});

    expect(harness.contents).toHaveBeenCalledWith({
      urls: ["https://example.com/"],
      format: "text",
      crawlTimeout: 20,
      extrasMeta: false,
    }, undefined);

    await expect(tool.execute("call", { url: "file:///etc/passwd" }, undefined, undefined, {})).rejects.toThrow("Unsupported URL protocol");
    await expect(tool.execute("call", { url: "https://user:pass@example.com" }, undefined, undefined, {})).rejects.toThrow("embedded credentials");
  });

  it("passes length limits and highlight requests through to /v1/contents", async () => {
    const harness = await createHarness();
    const tool = harness.tools.get("fetch_content")!;

    await tool.execute("call", {
      url: "https://example.com/",
      max_chars: 4_000,
      highlight_query: " rate limiter ",
      highlight_max_chars: 300,
    }, undefined, vi.fn(), {});

    expect(harness.contents).toHaveBeenLastCalledWith({
      urls: ["https://example.com/"],
      format: "markdown",
      crawlTimeout: 10,
      extrasMeta: true,
      contentMaxChars: 4_000,
      highlights: { query: "rate limiter", maxCharacters: 300 },
    }, undefined);

    await tool.execute("call", { url: "https://example.com/", highlight_max_chars: 2_000 }, undefined, vi.fn(), {});
    expect(harness.contents).toHaveBeenLastCalledWith(
      expect.objectContaining({ highlights: { maxCharacters: 2_000 } }),
      undefined,
    );

    // A blank highlight query is not a request for highlights.
    await tool.execute("call", { url: "https://example.com/", highlight_query: "   " }, undefined, vi.fn(), {});
    expect(harness.contents).toHaveBeenLastCalledWith(
      expect.objectContaining({ urls: ["https://example.com/"] }),
      undefined,
    );
    expect(harness.contents.mock.lastCall![0]).not.toHaveProperty("highlights");
  });

  it("reports an actionable error when no key is configured", async () => {
    const harness = await createHarness({ withConfig: false });
    const tool = harness.tools.get("web_search")!;
    await expect(tool.execute("call", { query: "pi" }, undefined, undefined, {})).rejects.toThrow("/querit-setup");
  });

  it("validates and saves a key through /querit-setup", async () => {
    const harness = await createHarness({ withConfig: false });
    const command = harness.commands.get("querit-setup")!;
    const notify = vi.fn();
    const setStatus = vi.fn();
    const select = vi.fn().mockImplementation(async (_message: string, options: string[]) => options[0]);
    const ctx = {
      mode: "tui",
      ui: {
        custom: vi.fn().mockResolvedValueOnce("new-test-key").mockResolvedValue(""),
        select,
        notify,
        setStatus,
      },
    };

    await command.handler("", ctx);

    expect(harness.search).toHaveBeenCalledWith({ query: "Querit API connectivity test", count: 1 });
    expect(JSON.parse(await readFile(harness.configPath, "utf8"))).toEqual({
      apiKey: "new-test-key",
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("configured successfully"), "info");
    expect(setStatus).toHaveBeenLastCalledWith("querit-setup", undefined);
  });

  it("shows a secondary menu and updates search defaults while keeping the saved key", async () => {
    const harness = await createHarness({
      configSettings: { search: { count: 5 } },
    });
    const command = harness.commands.get("querit-setup")!;
    const notify = vi.fn();
    const select = vi.fn()
      .mockResolvedValueOnce("Change search defaults")
      .mockResolvedValueOnce("10")
      .mockResolvedValueOnce("d7 (past 7 days)")
      .mockResolvedValueOnce("Skip (use API default)")
      .mockResolvedValueOnce("Enter a custom list…")
      .mockResolvedValueOnce("Skip (no domain filter)");
    const custom = vi.fn()
      .mockResolvedValueOnce("United States, Japan")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("github.com");
    const ctx = { mode: "tui", ui: { select, custom, notify, setStatus: vi.fn() } };

    await command.handler("", ctx);

    expect(select.mock.calls[0][0]).toContain("…-key");
    expect(JSON.parse(await readFile(harness.configPath, "utf8"))).toEqual({
      apiKey: "test-key",
      search: {
        count: 10,
        timeRange: "d7",
        countries: ["united states", "japan"],
        includeDomains: ["github.com"],
      },
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("search defaults updated"), "info");
    expect(harness.search).not.toHaveBeenCalled();
  });

  it("replaces the API key through the full re-setup flow", async () => {
    const harness = await createHarness({
      configSettings: { search: { count: 7 } },
    });
    const command = harness.commands.get("querit-setup")!;
    const notify = vi.fn();
    const select = vi.fn()
      .mockResolvedValueOnce("Replace API key (full re-setup)")
      .mockImplementation(async (_message: string, options: string[]) => options[0]);
    const ctx = {
      mode: "tui",
      ui: {
        custom: vi.fn().mockResolvedValueOnce("replacement-key").mockResolvedValue(""),
        select,
        notify,
        setStatus: vi.fn(),
      },
    };

    await command.handler("", ctx);

    expect(harness.search).toHaveBeenCalledWith({ query: "Querit API connectivity test", count: 1 });
    const saved = JSON.parse(await readFile(harness.configPath, "utf8"));
    expect(saved).toEqual({ apiKey: "replacement-key", search: { count: 7 } });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("configured successfully"), "info");
  });

  it("leaves the configuration untouched when the menu is dismissed", async () => {
    const harness = await createHarness();
    const command = harness.commands.get("querit-setup")!;
    const notify = vi.fn();
    const ctx = {
      mode: "tui",
      ui: { select: vi.fn().mockResolvedValue(undefined), custom: vi.fn(), notify, setStatus: vi.fn() },
    };

    await command.handler("", ctx);

    expect(JSON.parse(await readFile(harness.configPath, "utf8"))).toEqual({
      apiKey: "test-key",
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("cancelled"), "info");
  });

  it("keeps legacy configs (no search field) fully open without forcing prompts", async () => {
    const harness = await createHarness();

    const tool = harness.tools.get("web_search")!;
    await tool.execute("call", { query: "pi" }, undefined, vi.fn(), {});
    // Nothing configured means nothing sent: Querit's own defaults apply.
    expect(harness.search).toHaveBeenCalledWith({ query: "pi" }, undefined);

    const command = harness.commands.get("querit-setup")!;
    const notify = vi.fn();
    const select = vi.fn().mockResolvedValue(undefined);
    const ctx = { mode: "tui", ui: { select, custom: vi.fn(), notify, setStatus: vi.fn() } };
    await command.handler("", ctx);

    expect(select.mock.calls[0][0]).toContain("already configured");
    expect(JSON.parse(await readFile(harness.configPath, "utf8"))).toEqual({
      apiKey: "test-key",
    });
  });
});
