import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { QueritClient, type QueritSearchRequest } from "../src/client.js";
import {
  Config,
  DEFAULT_API_KEY_ENV,
  apply,
  inject,
  queritApiKeyConfigured,
  resolveOptions,
  resolveQueritApiKey,
  type ResolvedQueritConfig,
} from "../src/index.js";
import { QUERIT_PROVIDER_ID } from "../src/provider.js";

/** What `ctx.web.register*Provider` receives, narrowed to what the tests drive. */
interface RegisteredProvider {
  id: string;
  title?: string;
  description?: unknown;
  available: () => boolean;
  ready?: () => Promise<boolean>;
  search: (request: { query: string; maxResults?: number }, signal?: AbortSignal) => Promise<unknown>;
  fetch: (request: { url: string }, signal?: AbortSignal) => Promise<unknown>;
}

function fakeContext(overrides: Record<string, unknown> = {}): Context {
  const services = new Map<string, unknown>(Object.entries(overrides));
  const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
  const ctx = {
    get: (name: string) => services.get(name),
    // cordis runs an effect's callback at once and keeps its disposer.
    effect: vi.fn((setup: () => unknown) => {
      const dispose = setup();
      return typeof dispose === "function" ? (dispose as () => void) : () => {};
    }),
    on: vi.fn(() => () => {}),
    inject: vi.fn((deps: string[], callback: (ctx: Context) => void) => {
      if (deps.every((dep) => services.has(dep))) callback(ctx as unknown as Context);
      return () => {};
    }),
    fiber: { state: 0 },
    logger,
    ...overrides,
  };
  return ctx as unknown as Context;
}

type Handle = { get(): unknown };

/** The config as the host hands `apply`: every field a `Volatile` handle. */
function configHandles(overrides: Record<string, unknown> = {}): Config {
  const resolve = Config as unknown as (input: Record<string, unknown>) => Record<string, Handle>;
  return resolve(overrides) as unknown as Config;
}

/** Read every handle once, as `apply` does before an operation. */
function resolved(overrides: Record<string, unknown> = {}): ResolvedQueritConfig {
  const out: Record<string, unknown> = {};
  for (const [key, handle] of Object.entries(configHandles(overrides) as unknown as Record<string, Handle>)) {
    out[key] = handle.get();
  }
  return out as ResolvedQueritConfig;
}

/** A config whose handles answer the live value, as the host's do after an edit. */
function liveHandles(initial: Record<string, unknown>): {
  handles: Config;
  set: (key: string, value: unknown) => void;
  remove: (key: string) => void;
} {
  const base = configHandles({}) as unknown as Record<string, Handle>;
  const live = new Map<string, unknown>(Object.entries(initial));
  const proxy: Record<string, Handle> = {};
  for (const key of Object.keys(base)) {
    proxy[key] = { get: () => (live.has(key) ? live.get(key) : base[key]?.get()) };
  }
  return {
    handles: proxy as unknown as Config,
    set: (key, value) => { live.set(key, value); },
    remove: (key) => { live.delete(key); },
  };
}

/** Let the first-load configuration probe settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function warnOf(ctx: Context) {
  return (ctx as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger.warn;
}

describe("Config schema", () => {
  it("resolves an empty entry with defaults applied, and nothing Querit should default itself", () => {
    const section = resolved();
    expect(section.apiKeyEnv).toBe(DEFAULT_API_KEY_ENV);
    expect(section.count).toBeUndefined();
    expect(section.chunksPerDoc).toBeUndefined();
    expect(section.includeContent).toBe(false);
    expect(section.highlights).toBe(false);
    expect(section.needMarkdown).toBe(false);
    expect(section.contentMaxChars).toBeUndefined();
    expect(section.rank).toBeUndefined();
    expect(section.vertical).toBeUndefined();
    expect(section.fetchFormat).toBe("markdown");
    expect(section.fetchCrawlTimeout).toBe(10);
    expect(section.fetchMaxChars).toBe(8_000);
    expect(section.timeoutMs).toBe(70_000);
  });

  it("keeps a configured literal key in the resolved section", () => {
    expect(resolved({ apiKey: "sk-literal" }).apiKey).toBe("sk-literal");
  });

  it("accepts the newer fields across their documented ranges", () => {
    const section = resolved({
      count: 100,
      contentMaxChars: 1_000_000,
      chunksPerDoc: 3,
      highlights: true,
      needMarkdown: true,
      rank: "freshness",
      vertical: "code",
      resourceTags: ["qa", "github"],
    });
    expect(section).toMatchObject({
      count: 100,
      contentMaxChars: 1_000_000,
      chunksPerDoc: 3,
      highlights: true,
      needMarkdown: true,
      rank: "freshness",
      vertical: "code",
      resourceTags: ["qa", "github"],
    });
  });

  it.each([
    ["count", 101],
    ["count", 0],
    ["contentMaxChars", 0],
    ["contentMaxChars", 1_000_001],
    ["contentMaxChars", 2000.5],
    ["chunksPerDoc", 4],
    ["timeoutMs", 999],
    ["fetchCrawlTimeout", 61],
  ])("rejects %s = %s, which Querit documents as invalid", (field, value) => {
    expect(() => configHandles({ [field]: value })).toThrow();
  });

  it("defaults the fetch tool registration off (presets own web_fetch)", () => {
    const section = resolved();
    expect(section.fetch).toBe(false);
    expect(section.fetchTimeoutMs).toBe(30_000);
    expect(section.fetchMaxOutputChars).toBe(200_000);
  });
});

describe("resolveOptions", () => {
  it("applies constant and environment defaults and leaves count to Querit", async () => {
    const env = new Map<string, { value: string }>();
    const ctx = fakeContext({
      launchEnvironment: { get: (name: string) => env.get(name) },
    });
    const options = resolveOptions(ctx, resolved());

    expect(options.baseURL).toBe("https://api.querit.ai");
    expect(options.timeoutMs).toBe(70_000);
    expect(options.count).toBeUndefined();
    expect(options.chunksPerDoc).toBeUndefined();
    expect(options.includeContent).toBe(false);
    expect(options.highlights).toBe(false);
    expect(options.fetchMaxChars).toBe(8_000);
    expect(await options.resolveApiKey?.()).toBeUndefined();
    expect(await options.apiKeyConfigured?.()).toBe(false);
  });

  it("passes the newer defaults through to the providers", () => {
    const options = resolveOptions(fakeContext(), resolved({
      count: 20,
      includeContent: true,
      contentMaxChars: 2_000,
      highlights: true,
      needMarkdown: true,
      chunksPerDoc: 2,
      rank: "relevance",
      vertical: "finance",
      resourceTags: ["github"],
    }));

    expect(options).toMatchObject({
      count: 20,
      includeContent: true,
      contentMaxChars: 2_000,
      highlights: true,
      needMarkdown: true,
      chunksPerDoc: 2,
      rank: "relevance",
      vertical: "finance",
      resourceTags: ["github"],
    });
  });

  it("prefers the environment base URL over the constant", () => {
    const ctx = fakeContext({
      launchEnvironment: { get: (name: string) => name === "QUERIT_BASE_URL" ? { value: "https://proxy.example/" } : undefined },
    });
    expect(resolveOptions(ctx, resolved()).baseURL).toBe("https://proxy.example");
  });

  it("normalizes domains and enum lists", () => {
    const options = resolveOptions(fakeContext(), resolved({
      includeDomains: ["GitHub.com", "https://example.com/x"],
      countries: ["United States", "atlantis"],
      languages: ["english", "Russian", "klingon"],
      rank: " FRESHNESS ",
      vertical: "Code",
      resourceTags: ["GitHub", "unknown"],
      timeRange: " m3 ",
    }));

    expect(options.includeDomains).toEqual(["github.com", "example.com"]);
    expect(options.countries).toEqual(["united states"]);
    expect(options.languages).toEqual(["english", "russian"]);
    expect(options.rank).toBe("freshness");
    expect(options.vertical).toBe("code");
    expect(options.resourceTags).toEqual(["github"]);
    expect(options.timeRange).toBe("m3");
  });

  it("drops an invalid time range rather than failing every search", () => {
    expect(resolveOptions(fakeContext(), resolved({ timeRange: "yesterday" })).timeRange).toBeUndefined();
  });
});

describe("resolveQueritApiKey", () => {
  const ref = credentialRef(DEFAULT_API_KEY_ENV);

  it("lets an installed credentials service decide, including absence", async () => {
    let storedKey: string | undefined = "sk-stored";
    const ctx = fakeContext({
      launchEnvironment: { get: () => ({ value: "sk-env" }) },
      credentials: { resolve: async () => (storedKey === undefined ? undefined : { value: storedKey }) },
    });

    await expect(resolveQueritApiKey(ctx, ref)).resolves.toBe("sk-stored");
    storedKey = undefined;
    await expect(resolveQueritApiKey(ctx, ref)).resolves.toBeUndefined();
  });

  it("reads the launching environment only where no credentials service runs", async () => {
    const ctx = fakeContext({
      launchEnvironment: { get: (name: string) => (name === "QUERIT_API_KEY" ? { value: "sk-env" } : undefined) },
    });

    await expect(resolveQueritApiKey(ctx, ref)).resolves.toBe("sk-env");
  });

  it("returns undefined when nothing is configured", async () => {
    const ctx = fakeContext({ launchEnvironment: { get: () => undefined } });

    await expect(resolveQueritApiKey(ctx, ref)).resolves.toBeUndefined();
  });
});

describe("queritApiKeyConfigured", () => {
  const ref = credentialRef(DEFAULT_API_KEY_ENV);

  it("asks the credentials service without resolving the key", async () => {
    const describe = vi.fn(async () => ({ configured: true }));
    await expect(queritApiKeyConfigured(fakeContext({ credentials: { describe } }), ref)).resolves.toBe(true);
    expect(describe).toHaveBeenCalledWith("QUERIT_API_KEY");
  });

  it("falls back to the launching environment", async () => {
    const ctx = fakeContext({ launchEnvironment: { get: (name: string) => (name === "QUERIT_API_KEY" ? { value: "" } : undefined) } });
    await expect(queritApiKeyConfigured(ctx, ref)).resolves.toBe(false);
  });
});

describe("apply", () => {
  function fakeWebRegistries() {
    const registered: { kind: string; provider: RegisteredProvider }[] = [];
    const web = {
      registerSearchProvider: (provider: RegisteredProvider) => {
        registered.push({ kind: "search", provider });
        return () => {};
      },
      registerFetchProvider: (provider: RegisteredProvider) => {
        registered.push({ kind: "fetch", provider });
        return () => {};
      },
    };
    const registeredTools: string[] = [];
    const tools = {
      register: (definition: { name: string }) => {
        registeredTools.push(definition.name);
        return () => {};
      },
    };
    const sections: string[] = [];
    const systemPrompt = {
      section: (section: { name: string }) => {
        sections.push(section.name);
        return () => {};
      },
      getSectionOrder: (slot: string) => slot.length,
    };
    return { registered, registeredTools, sections, web, tools, systemPrompt };
  }

  it("requires only the web seam", () => {
    expect(inject).toEqual(["web"]);
  });

  it("registers search and fetch providers that describe and report themselves", async () => {
    const { registered, registeredTools, sections, web, tools, systemPrompt } = fakeWebRegistries();
    const ctx = fakeContext({ web, tools, systemPrompt, launchEnvironment: { get: () => undefined } });

    apply(ctx, configHandles());
    await flush();

    expect(registered.map((entry) => [entry.kind, entry.provider.id])).toEqual([
      ["search", QUERIT_PROVIDER_ID],
      ["fetch", QUERIT_PROVIDER_ID],
    ]);
    expect(QUERIT_PROVIDER_ID).toBe("web-search-querit");
    for (const { provider } of registered) {
      expect(provider.title).toBe("Querit");
      expect(provider.description).toMatchObject({ en: expect.stringContaining("Querit"), zh: expect.stringContaining("Querit") });
      expect(provider.available()).toBe(true);
      // No key anywhere: the seam withholds the web tools for this step.
      await expect(provider.ready!()).resolves.toBe(false);
    }
    expect(registeredTools).toEqual([]);
    expect(sections).toEqual([]);
  });

  it("answers ready from the configured credential", async () => {
    const { registered, web } = fakeWebRegistries();
    let configured = true;
    const ctx = fakeContext({ web, credentials: { describe: async () => ({ configured }) } });

    apply(ctx, configHandles({ apiKeyEnv: "QUERIT_API_KEY" }));
    await flush();

    await expect(registered[0]!.provider.ready!()).resolves.toBe(true);
    configured = false;
    await expect(registered[1]!.provider.ready!()).resolves.toBe(false);
  });

  it("serves every operation from the config as it stands then", async () => {
    const { registered, web } = fakeWebRegistries();
    const ctx = fakeContext({ web, launchEnvironment: { get: () => undefined } });
    const requests: QueritSearchRequest[] = [];
    const searchSpy = vi.spyOn(QueritClient.prototype, "search").mockImplementation(async (request) => {
      requests.push(request);
      return { query: request.query, results: [] };
    });

    try {
      const { handles, set, remove } = liveHandles({ apiKey: "sk-literal", count: 5, vertical: "code", rank: "freshness" });
      apply(ctx, handles);
      const search = () => registered[0]!.provider.search({ query: "q" });

      await search();
      set("count", 12);
      set("highlights", true);
      await search();
      remove("vertical");
      await search();

      expect(requests).toEqual([
        // The code vertical rejects rank, so the configured preference is dropped.
        { query: "q", count: 5, needContent: false, filters: { vertical: "code" } },
        { query: "q", count: 12, highlights: true, needContent: false, filters: { vertical: "code" } },
        { query: "q", count: 12, highlights: true, needContent: false, rank: { preference: "freshness" } },
      ]);
    } finally {
      searchSpy.mockRestore();
    }
  });

  it("registers the web_fetch tool when fetch is true", async () => {
    const { registeredTools, sections, web, tools, systemPrompt } = fakeWebRegistries();
    const ctx = fakeContext({ web, tools, systemPrompt, launchEnvironment: { get: () => undefined } });

    apply(ctx, configHandles({ fetch: true }));
    await flush();

    expect(registeredTools).toEqual(["web_fetch"]);
    expect(sections).toEqual(["tool:web_fetch"]);
  });

  it("opts out of the generated settings page when the settings service is present", async () => {
    const { web } = fakeWebRegistries();
    const configure = vi.fn((_presentation: unknown, _owner?: unknown) => () => {});
    const ctx = fakeContext({ web, settings: { configure }, launchEnvironment: { get: () => undefined } });

    apply(ctx, configHandles());
    await flush();

    expect(configure).toHaveBeenCalledTimes(1);
    expect(configure.mock.calls[0]![0]).toEqual({ auto: false });
    expect(configure.mock.calls[0]![1]).toBe((ctx as unknown as { fiber: unknown }).fiber);
  });

  it("loads without a settings service", async () => {
    const { registered, web } = fakeWebRegistries();
    const ctx = fakeContext({ web, launchEnvironment: { get: () => undefined } });

    apply(ctx, configHandles());
    await flush();

    expect(registered).toHaveLength(2);
  });

  it("warns on first load when no API key is configured", async () => {
    const { web } = fakeWebRegistries();
    const ctx = fakeContext({ web, launchEnvironment: { get: () => undefined } });

    apply(ctx, configHandles());
    await flush();

    expect(warnOf(ctx)).toHaveBeenCalledTimes(1);
    expect(String(warnOf(ctx).mock.calls[0]![0])).toContain("QUERIT_API_KEY");
    expect(String(warnOf(ctx).mock.calls[0]![0])).toContain("web-search-querit row");
  });

  it("does not warn on first load when a literal key is set", async () => {
    const { web } = fakeWebRegistries();
    const ctx = fakeContext({ web, launchEnvironment: { get: () => undefined }, credentials: { resolve: async () => undefined } });

    apply(ctx, configHandles({ apiKey: "sk-literal" }));
    await flush();

    expect(warnOf(ctx)).not.toHaveBeenCalled();
  });

  it("does not warn when the credentials service resolves a key", async () => {
    const { web } = fakeWebRegistries();
    const ctx = fakeContext({ web, launchEnvironment: { get: () => undefined }, credentials: { resolve: async () => ({ value: "sk-stored" }) } });

    apply(ctx, configHandles());
    await flush();

    expect(warnOf(ctx)).not.toHaveBeenCalled();
  });

  it("logs search_id, took, and cost for every operation", async () => {
    const { registered, web } = fakeWebRegistries();
    const ctx = fakeContext({ web, launchEnvironment: { get: () => undefined } });
    const info = (ctx as unknown as { logger: { info: ReturnType<typeof vi.fn> } }).logger.info;
    const searchSpy = vi.spyOn(QueritClient.prototype, "search").mockResolvedValue({
      query: "q",
      results: [],
      searchId: "9007199254740993123",
      took: "0.42",
      cost: { currency: "USD", total: 0.000123 },
    });
    const contentsSpy = vi.spyOn(QueritClient.prototype, "contents").mockResolvedValue({
      results: [{ url: "https://example.com/", content: "body", highlights: [] }],
      statuses: [{ status: "success" }],
      searchId: "7",
      searchTime: 2,
    });

    try {
      apply(ctx, configHandles({ apiKey: "sk-literal" }));
      await registered[0]!.provider.search({ query: "q" });
      await registered[1]!.provider.fetch({ url: "https://example.com/" });
    } finally {
      searchSpy.mockRestore();
      contentsSpy.mockRestore();
    }

    expect(info.mock.calls.map((call) => call[0])).toEqual([
      "web-search-querit: search search_id=9007199254740993123 took=0.42 cost=USD 0.000123",
      // An absent cost is reported as unavailable, never as zero.
      "web-search-querit: fetch search_id=7 took=2s cost=n/a",
    ]);
  });
});
