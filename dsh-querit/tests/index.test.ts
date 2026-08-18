import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  Config,
  DEFAULT_API_KEY_ENV,
  WEB_SEARCH_QUERIT_SETTINGS_NAMESPACE,
  apply,
  resolveOptions,
  resolveQueritApiKey,
  validateSection,
} from "../src/index.js";
import { QUERIT_PROVIDER_ID, QueritSearchProvider } from "../src/provider.js";

function fakeContext(overrides: Record<string, unknown> = {}): Context {
  const services = new Map<string, unknown>(Object.entries(overrides));
  const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
  const ctx = {
    get: (name: string) => services.get(name),
    effect: vi.fn(() => () => {}),
    on: vi.fn(() => () => {}),
    inject: vi.fn(() => () => {}),
    fiber: { state: 0 },
    logger,
    ...overrides,
  };
  return ctx as unknown as Context;
}

describe("Config schema", () => {
  it("resolves an empty entry with defaults applied", () => {
    const resolved = Config({});
    expect(resolved.apiKeyEnv).toBe(DEFAULT_API_KEY_ENV);
    expect(resolved.count).toBe(5);
    expect(resolved.includeContent).toBe(false);
    expect(resolved.chunksPerDoc).toBe(1);
    expect(resolved.fetchFormat).toBe("markdown");
    expect(resolved.fetchCrawlTimeout).toBe(10);
    expect(resolved.fetchMaxChars).toBe(8_000);
    expect(resolved.timeoutMs).toBe(70_000);
  });

  it("keeps a configured literal key in the resolved section", () => {
    expect(Config({ apiKey: "sk-literal" }).apiKey).toBe("sk-literal");
  });

  it("defaults the fetch tool registration", () => {
    const resolved = Config({});
    expect(resolved.fetch).toBe(true);
    expect(resolved.fetchTimeoutMs).toBe(30_000);
    expect(resolved.fetchMaxOutputChars).toBe(200_000);
  });
});

describe("resolveOptions", () => {
  it("applies constant and environment defaults", async () => {
    const env = new Map<string, { value: string }>();
    const ctx = fakeContext({
      launchEnvironment: { get: (name: string) => env.get(name) },
    });
    const options = resolveOptions(ctx, Config({}));

    expect(options.baseURL).toBe("https://api.querit.ai");
    expect(options.timeoutMs).toBe(70_000);
    expect(options.count).toBe(5);
    expect(options.includeContent).toBe(false);
    expect(options.fetchMaxChars).toBe(8_000);
    expect(await options.resolveApiKey?.()).toBeUndefined();
  });

  it("preserves environment, credentials, then literal key priority through the provider", async () => {
    let environmentKey: string | undefined = "sk-env";
    let storedKey: string | undefined = "sk-stored";
    const selectedKeys: string[] = [];
    const ctx = fakeContext({
      launchEnvironment: {
        get: (name: string) => name === DEFAULT_API_KEY_ENV && environmentKey !== undefined
          ? { value: environmentKey }
          : undefined,
      },
      credentials: {
        resolve: async () => storedKey === undefined ? undefined : { value: storedKey },
      },
    });
    const provider = new QueritSearchProvider(() => ({
      ...resolveOptions(ctx, Config({ apiKey: " sk-literal " })),
      clientFactory: ({ apiKey }) => {
        selectedKeys.push(apiKey);
        return {
          search: async ({ query }) => ({ query, results: [] }),
          contents: async () => ({ results: [], statuses: [] }),
        };
      },
    }));

    await provider.search({ query: "environment" });
    environmentKey = undefined;
    await provider.search({ query: "credentials" });
    storedKey = undefined;
    await provider.search({ query: "literal" });

    expect(selectedKeys).toEqual(["sk-env", "sk-stored", "sk-literal"]);
  });

  it("prefers the environment base URL over the constant", () => {
    const ctx = fakeContext({
      launchEnvironment: { get: (name: string) => name === "QUERIT_BASE_URL" ? { value: "https://proxy.example/" } : undefined },
    });
    expect(resolveOptions(ctx, Config({})).baseURL).toBe("https://proxy.example");
  });

  it("normalizes domains and enum lists", () => {
    const ctx = fakeContext();
    const options = resolveOptions(ctx, Config({
      includeDomains: ["GitHub.com", "https://example.com/x"],
      countries: ["United States", "atlantis"],
      languages: ["english", "klingon"],
      timeRange: " m3 ",
    }));

    expect(options.includeDomains).toEqual(["github.com", "example.com"]);
    expect(options.countries).toEqual(["united states"]);
    expect(options.languages).toEqual(["english"]);
    expect(options.timeRange).toBe("m3");
  });
});

describe("validateSection", () => {
  it("accepts a clean section", () => {
    expect(() => validateSection(Config({
      timeRange: "y1",
      countries: ["japan"],
      includeDomains: ["github.com"],
    }))).not.toThrow();
  });

  it("rejects an unparseable base URL", () => {
    expect(() => validateSection(Config({ baseURL: "not a url" }))).toThrow("baseURL");
  });

  it("rejects an invalid time range", () => {
    expect(() => validateSection(Config({ timeRange: "yesterday" }))).toThrow("timeRange");
  });

  it("rejects unknown countries and languages", () => {
    expect(() => validateSection(Config({ countries: ["atlantis"] }))).toThrow("countries");
    expect(() => validateSection(Config({ languages: ["klingon"] }))).toThrow("languages");
  });

  it("rejects malformed domains", () => {
    expect(() => validateSection(Config({ includeDomains: ["no dot here"] }))).toThrow("includeDomains");
    expect(() => validateSection(Config({ excludeDomains: ["has space.com"] }))).toThrow("excludeDomains");
  });
});

describe("resolveQueritApiKey", () => {
  const ref = credentialRef(DEFAULT_API_KEY_ENV);

  it("prefers the launching environment over stored and literal keys", async () => {
    const ctx = fakeContext({
      launchEnvironment: { get: (name: string) => name === "QUERIT_API_KEY" ? { value: "sk-env" } : undefined },
      credentials: { resolve: async () => ({ value: "sk-stored" }) },
    });

    await expect(resolveQueritApiKey(ctx, ref, "sk-literal")).resolves.toBe("sk-env");
  });

  it("prefers the credentials store over the literal row key", async () => {
    const ctx = fakeContext({
      launchEnvironment: { get: () => undefined },
      credentials: { resolve: async () => ({ value: "sk-stored" }) },
    });

    await expect(resolveQueritApiKey(ctx, ref, "sk-literal")).resolves.toBe("sk-stored");
  });

  it("uses the literal row key when no environment or store key exists", async () => {
    const ctx = fakeContext({ launchEnvironment: { get: () => undefined } });

    await expect(resolveQueritApiKey(ctx, ref, "sk-literal")).resolves.toBe("sk-literal");
  });

  it("returns undefined when nothing is configured", async () => {
    const ctx = fakeContext({ launchEnvironment: { get: () => undefined } });

    await expect(resolveQueritApiKey(ctx, ref, undefined)).resolves.toBeUndefined();
  });
});

describe("apply", () => {
  function fakeWebRegistries() {
    const registered: { kind: string; provider: { id: string } }[] = [];
    const web = {
      registerSearchProvider: (provider: { id: string }) => {
        registered.push({ kind: "search", provider });
        return () => {};
      },
      registerFetchProvider: (provider: { id: string }) => {
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
    };
    return { registered, registeredTools, sections, web, tools, systemPrompt };
  }

  it("registers search and fetch providers under the querit id plus the web_fetch tool", async () => {
    const { registered, registeredTools, sections, web, tools, systemPrompt } = fakeWebRegistries();
    const ctx = fakeContext({ web, tools, systemPrompt });

    await apply(ctx, Config({}));

    expect(registered).toHaveLength(2);
    expect(registered.map((entry) => [entry.kind, entry.provider.id])).toEqual([
      ["search", QUERIT_PROVIDER_ID],
      ["fetch", QUERIT_PROVIDER_ID],
    ]);
    expect(registeredTools).toEqual(["web_fetch"]);
    expect(sections).toEqual(["tool:web_fetch"]);
  });

  it("skips the web_fetch tool when fetch is false", async () => {
    const { registeredTools, web, tools, systemPrompt } = fakeWebRegistries();
    const ctx = fakeContext({ web, tools, systemPrompt });

    await apply(ctx, Config({ fetch: false }));

    expect(registeredTools).toEqual([]);
  });

  it("warns on first load when no API key is configured", async () => {
    const { web, tools, systemPrompt } = fakeWebRegistries();
    const ctx = fakeContext({
      web,
      tools,
      systemPrompt,
      launchEnvironment: { get: () => undefined },
    });

    await apply(ctx, Config({}));

    const warn = (ctx as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger.warn;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("QUERIT_API_KEY");
  });

  it("does not warn on first load when a literal key follows an empty credentials lookup", async () => {
    const { web, tools, systemPrompt } = fakeWebRegistries();
    const ctx = fakeContext({
      web,
      tools,
      systemPrompt,
      launchEnvironment: { get: () => undefined },
      credentials: { resolve: async () => undefined },
    });

    await apply(ctx, Config({ apiKey: "sk-literal" }));

    const warn = (ctx as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger.warn;
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn when the credentials service resolves a key", async () => {
    const { web, tools, systemPrompt } = fakeWebRegistries();
    const ctx = fakeContext({
      web,
      tools,
      systemPrompt,
      launchEnvironment: { get: () => undefined },
      credentials: { resolve: async () => ({ value: "sk-stored" }) },
    });

    await apply(ctx, Config({}));

    const warn = (ctx as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger.warn;
    expect(warn).not.toHaveBeenCalled();
  });

  it("names the settings namespace after the plugin", () => {
    expect(WEB_SEARCH_QUERIT_SETTINGS_NAMESPACE).toBe("web-search-querit");
  });
});
