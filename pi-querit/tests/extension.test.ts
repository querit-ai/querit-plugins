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
  summaryGenerator?: (...args: any[]) => Promise<any>;
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
  } as unknown as ExtensionAPI;

  const search = vi.fn(options.search ?? (async (request: QueritSearchRequest) => ({
    query: request.query,
    searchId: "1",
    results: [{ title: "Example", url: "https://example.com/", snippet: "Snippet", sentences: [] }],
  })));
  const contents = vi.fn(options.contents ?? (async () => ({
    searchId: "2",
    results: [{ url: "https://example.com/", content: "Body" }],
    statuses: [{ id: "1", status: "success" }],
  })));

  registerQueritExtension(pi, {
    configPath,
    env: {},
    clientFactory: () => ({ search, contents }),
    ...(options.summaryGenerator ? { summaryGenerator: options.summaryGenerator as any } : {}),
  });

  return { tools, commands, search, contents, configPath };
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
      needContent: true,
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

  it("uses the fixed setup model for optional summaries and accounts for usage", async () => {
    const usage = {
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 120,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    };
    const summaryGenerator = vi.fn(async () => ({
      summary: "Pi is a coding agent [1].",
      model: "anthropic/summary-model",
      usage,
    }));
    const harness = await createHarness({
      configSettings: { defaultWorkflow: "summary", summaryModel: "anthropic/summary-model" },
      summaryGenerator,
    });
    const tool = harness.tools.get("web_search")!;
    const context = { modelRegistry: {} };
    const summarized = await tool.execute("call", { query: "pi" }, undefined, vi.fn(), context);

    expect(summaryGenerator).toHaveBeenCalledWith(
      expect.objectContaining({ query: "pi" }),
      context,
      "anthropic/summary-model",
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(summarized.content[0].text).toContain("Querit auto-summary");
    expect(summarized.content[0].text).toContain("https://example.com/");
    expect(summarized.details.workflow).toBe("summary");
    expect(summarized.details.summaryModel).toBe("anthropic/summary-model");
    expect(summarized.usage).toEqual(usage);

    await tool.execute("call", { query: "pi", workflow: "raw" }, undefined, undefined, context);
    expect(summaryGenerator).toHaveBeenCalledOnce();
  });

  it("falls back to raw results when optional summary generation is unavailable", async () => {
    const harness = await createHarness({
      configSettings: { defaultWorkflow: "raw", summaryModel: "anthropic/summary-model" },
      summaryGenerator: vi.fn(async () => ({ fallbackReason: "model unavailable" })),
    });
    const tool = harness.tools.get("web_search")!;
    const result = await tool.execute("call", { query: "pi", workflow: "summary" }, undefined, undefined, {});

    expect(result.content[0].text).toContain("Auto-summary unavailable: model unavailable");
    expect(result.content[0].text).toContain("# Querit search results");
    expect(result.details.summaryFallbackReason).toBe("model unavailable");
    expect(result.usage).toBeUndefined();
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
    const currentModel = { provider: "anthropic", id: "summary-model" };
    const select = vi.fn().mockImplementation(async (_message: string, options: string[]) => options[0]);
    const ctx = {
      mode: "tui",
      model: currentModel,
      scopedModels: [{ model: currentModel }],
      modelRegistry: {
        getAvailable: vi.fn(() => [currentModel]),
        find: vi.fn(() => currentModel),
        getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "model-key" })),
      },
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
      defaultWorkflow: "raw",
    });
    const modelPrompt = select.mock.calls.find(([message]) => String(message).includes("Fixed model"));
    expect(modelPrompt).toBeUndefined();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("configured successfully"), "info");
    expect(setStatus).toHaveBeenLastCalledWith("querit-setup", undefined);
  });

  it("shows a secondary menu and updates search defaults while keeping the saved key", async () => {
    const harness = await createHarness({
      configSettings: { defaultWorkflow: "summary", summaryModel: "anthropic/summary-model" },
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
      defaultWorkflow: "summary",
      summaryModel: "anthropic/summary-model",
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

  it("updates summary settings from the menu and preserves search defaults", async () => {
    const harness = await createHarness({
      configSettings: { defaultWorkflow: "raw", search: { count: 7 } },
    });
    const command = harness.commands.get("querit-setup")!;
    const notify = vi.fn();
    const currentModel = { provider: "anthropic", id: "summary-model" };
    const select = vi.fn()
      .mockResolvedValueOnce("Change summary settings")
      .mockResolvedValueOnce("Auto-summary before returning results");
    const custom = vi.fn(async (factory: any) => {
      return new Promise<string | undefined>((resolve) => {
        const component = factory(
          { requestRender: vi.fn() },
          { fg: (_color: string, text: string) => text, bold: (text: string) => text },
          {},
          resolve,
        );
        component.focused = true;
        component.handleInput("\n");
      });
    });
    const ctx = {
      mode: "tui",
      model: currentModel,
      scopedModels: [{ model: currentModel }],
      modelRegistry: {
        getAvailable: vi.fn(() => []),
        find: vi.fn(() => currentModel),
        getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "model-key" })),
      },
      ui: { select, custom, notify, setStatus: vi.fn() },
    };

    await command.handler("", ctx);

    expect(JSON.parse(await readFile(harness.configPath, "utf8"))).toEqual({
      apiKey: "test-key",
      defaultWorkflow: "summary",
      summaryModel: "anthropic/summary-model",
      search: { count: 7 },
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("summary settings updated"), "info");
  });

  it("replaces the API key through the full re-setup flow", async () => {
    const harness = await createHarness();
    const command = harness.commands.get("querit-setup")!;
    const notify = vi.fn();
    const currentModel = { provider: "anthropic", id: "summary-model" };
    const select = vi.fn()
      .mockResolvedValueOnce("Replace API key (full re-setup)")
      .mockImplementation(async (_message: string, options: string[]) => options[0]);
    const ctx = {
      mode: "tui",
      model: currentModel,
      scopedModels: [{ model: currentModel }],
      modelRegistry: {
        getAvailable: vi.fn(() => []),
        find: vi.fn(() => currentModel),
        getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "model-key" })),
      },
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
    expect(saved.apiKey).toBe("replacement-key");
    expect(saved.defaultWorkflow).toBe("raw");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("configured successfully"), "info");
  });

  it("leaves the configuration untouched when the menu is dismissed", async () => {
    const harness = await createHarness({
      configSettings: { defaultWorkflow: "summary", summaryModel: "anthropic/summary-model" },
    });
    const command = harness.commands.get("querit-setup")!;
    const notify = vi.fn();
    const ctx = {
      mode: "tui",
      ui: { select: vi.fn().mockResolvedValue(undefined), custom: vi.fn(), notify, setStatus: vi.fn() },
    };

    await command.handler("", ctx);

    expect(JSON.parse(await readFile(harness.configPath, "utf8"))).toEqual({
      apiKey: "test-key",
      defaultWorkflow: "summary",
      summaryModel: "anthropic/summary-model",
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("cancelled"), "info");
  });

  it("keeps legacy configs (no search field) fully open without forcing prompts", async () => {
    const harness = await createHarness({
      configSettings: { defaultWorkflow: "summary", summaryModel: "anthropic/summary-model" },
    });

    const tool = harness.tools.get("web_search")!;
    await tool.execute("call", { query: "pi" }, undefined, vi.fn(), {});
    expect(harness.search).toHaveBeenCalledWith({ query: "pi", count: 5 }, undefined);

    const command = harness.commands.get("querit-setup")!;
    const notify = vi.fn();
    const select = vi.fn().mockResolvedValue(undefined);
    const ctx = { mode: "tui", ui: { select, custom: vi.fn(), notify, setStatus: vi.fn() } };
    await command.handler("", ctx);

    expect(select.mock.calls[0][0]).toContain("already configured");
    expect(JSON.parse(await readFile(harness.configPath, "utf8"))).toEqual({
      apiKey: "test-key",
      defaultWorkflow: "summary",
      summaryModel: "anthropic/summary-model",
    });
  });
});
