import { describe, expect, it } from "vitest";
import { QUERIT_CONTENT_MAX_CHARS_LIMIT, QUERIT_COUNT_LIMIT } from "../src/client.js";
import {
  BASE_URL_ENV,
  DEFAULT_API_KEY_ENV,
  resolveConfig,
  resolveQueritApiKey,
  type OpenCodeQueritOptions,
} from "../src/config.js";

/** Plugin options are JSON in practice, so a test may hand in values the types rule out. */
function raw(options: object): OpenCodeQueritOptions {
  return options as OpenCodeQueritOptions;
}

describe("resolveConfig", () => {
  it("applies defaults for every field", () => {
    const config = resolveConfig({}, {});
    expect(config.apiKey).toBeUndefined();
    expect(config.apiKeyEnv).toBe("QUERIT_API_KEY");
    expect(config.baseURL).toBe("https://api.querit.ai");
    expect(config.timeoutMs).toBe(70_000);
    // Left to Querit's server: the plugin never invents a count or sends the deprecated chunksPerDoc.
    expect(config.count).toBeUndefined();
    expect(config.chunksPerDoc).toBeUndefined();
    expect(config.timeRange).toBeUndefined();
    expect(config.countries).toEqual([]);
    expect(config.languages).toEqual([]);
    expect(config.includeDomains).toEqual([]);
    expect(config.excludeDomains).toEqual([]);
    expect(config.vertical).toBeUndefined();
    expect(config.resourceTags).toEqual([]);
    expect(config.rank).toBeUndefined();
    expect(config.highlights).toBe(false);
    expect(config.includeContent).toBe(false);
    expect(config.contentMaxChars).toBeUndefined();
    expect(config.needMarkdown).toBe(false);
    expect(config.fetchFormat).toBe("markdown");
    expect(config.fetchCrawlTimeout).toBe(10);
    expect(config.fetchMaxChars).toBe(8_000);
    expect(config.maxOutputChars).toBe(200_000);
  });

  it("passes through provided options", () => {
    const config = resolveConfig({
      apiKey: "  sk-123  ",
      baseURL: "https://proxy.example/",
      timeoutMs: 42_000,
      count: 8,
      timeRange: "m3",
      countries: ["united states", "japan"],
      languages: ["english", "russian"],
      includeDomains: ["github.com"],
      excludeDomains: ["pinterest.com", "facebook.com", "instagram.com", "tiktok.com"],
      vertical: "code",
      resourceTags: ["qa", "github"],
      rank: "freshness",
      highlights: true,
      includeContent: true,
      contentMaxChars: 2_000,
      needMarkdown: true,
      chunksPerDoc: 2,
      fetchFormat: "html",
      fetchCrawlTimeout: 20,
      fetchMaxChars: 1_000,
      maxOutputChars: 50_000,
    }, {});
    expect(config.apiKey).toBe("sk-123");
    expect(config.baseURL).toBe("https://proxy.example");
    expect(config.timeoutMs).toBe(42_000);
    expect(config.count).toBe(8);
    expect(config.timeRange).toBe("m3");
    expect(config.countries).toEqual(["united states", "japan"]);
    expect(config.languages).toEqual(["english", "russian"]);
    expect(config.includeDomains).toEqual(["github.com"]);
    expect(config.excludeDomains).toHaveLength(4);
    expect(config.vertical).toBe("code");
    expect(config.resourceTags).toEqual(["qa", "github"]);
    expect(config.rank).toBe("freshness");
    expect(config.highlights).toBe(true);
    expect(config.includeContent).toBe(true);
    expect(config.contentMaxChars).toBe(2_000);
    expect(config.needMarkdown).toBe(true);
    expect(config.chunksPerDoc).toBe(2);
    expect(config.fetchFormat).toBe("html");
    expect(config.fetchCrawlTimeout).toBe(20);
    expect(config.fetchMaxChars).toBe(1_000);
    expect(config.maxOutputChars).toBe(50_000);
  });

  it("accepts count up to the API limit and normalizes enum options", () => {
    const config = resolveConfig(raw({ count: QUERIT_COUNT_LIMIT, vertical: " Finance ", fetchFormat: " HTML " }), {});
    expect(config.count).toBe(100);
    expect(config.vertical).toBe("finance");
    expect(config.fetchFormat).toBe("html");
  });

  it("falls back to QUERIT_BASE_URL from the environment", () => {
    const config = resolveConfig({}, { [BASE_URL_ENV]: "https://env.example/" });
    expect(config.baseURL).toBe("https://env.example");
  });

  it("normalizes domains to bare hostnames", () => {
    const config = resolveConfig({
      includeDomains: ["https://Github.com/path", "stackoverflow.com"],
    }, {});
    expect(config.includeDomains).toEqual(["github.com", "stackoverflow.com"]);
  });

  it("throws on a base URL that is not HTTP(S)", () => {
    expect(() => resolveConfig({ baseURL: "not a url" }, {})).toThrow("baseURL");
    expect(() => resolveConfig({ baseURL: "ftp://example.com" }, {})).toThrow("baseURL");
  });

  it("throws on unknown countries and languages", () => {
    expect(() => resolveConfig(raw({ countries: ["atlantis"] }), {})).toThrow("countries");
    expect(() => resolveConfig(raw({ languages: ["klingon"] }), {})).toThrow("languages");
  });

  it("throws on unknown verticals, resource tags, ranks, and fetch formats", () => {
    expect(() => resolveConfig(raw({ vertical: "legal" }), {})).toThrow('vertical must be one of: code, finance (got: legal).');
    expect(() => resolveConfig(raw({ resourceTags: ["blog"] }), {})).toThrow("resourceTags contains unsupported values: blog. Allowed: qa, github.");
    expect(() => resolveConfig(raw({ rank: "popular" }), {})).toThrow("rank must be one of: relevance, freshness (got: popular).");
    expect(() => resolveConfig(raw({ fetchFormat: "json" }), {})).toThrow("fetchFormat must be one of: text, markdown, html (got: json).");
  });

  it("throws when resource tags are set without the code vertical", () => {
    expect(() => resolveConfig({ resourceTags: ["qa"] }, {})).toThrow('resourceTags only applies to the "code" vertical');
    expect(() => resolveConfig({ vertical: "finance", resourceTags: ["qa"] }, {})).toThrow('resourceTags only applies to the "code" vertical');
    expect(resolveConfig({ vertical: "code", resourceTags: ["qa"] }, {}).resourceTags).toEqual(["qa"]);
  });

  it("throws on out-of-range numeric options", () => {
    expect(() => resolveConfig({ count: QUERIT_COUNT_LIMIT + 1 }, {})).toThrow("count must be an integer between 1 and 100.");
    expect(() => resolveConfig({ count: 0 }, {})).toThrow("count");
    expect(() => resolveConfig({ chunksPerDoc: 4 }, {})).toThrow("chunksPerDoc");
    expect(() => resolveConfig({ contentMaxChars: 0 }, {})).toThrow("contentMaxChars");
    expect(() => resolveConfig({ contentMaxChars: QUERIT_CONTENT_MAX_CHARS_LIMIT + 1 }, {})).toThrow(
      "contentMaxChars must be an integer between 1 and 1000000.",
    );
    expect(() => resolveConfig({ fetchCrawlTimeout: 61 }, {})).toThrow("fetchCrawlTimeout must be an integer between 1 and 60 seconds.");
    expect(() => resolveConfig({ timeoutMs: 500 }, {})).toThrow("timeoutMs");
    expect(() => resolveConfig({ fetchMaxChars: 10 }, {})).toThrow("fetchMaxChars");
  });

  it("throws on an invalid timeRange", () => {
    expect(() => resolveConfig({ timeRange: "last week" }, {})).toThrow("timeRange");
    // Letter first; no spaces inside a range.
    expect(() => resolveConfig({ timeRange: "7d" }, {})).toThrow("timeRange");
    expect(() => resolveConfig({ timeRange: "2026-01-01 to 2026-02-01" }, {})).toThrow("timeRange");
    expect(resolveConfig({ timeRange: "2026-01-01to2026-02-01" }, {}).timeRange).toBe("2026-01-01to2026-02-01");
  });
});

describe("resolveQueritApiKey", () => {
  it("prefers the environment variable over the literal apiKey option", () => {
    const config = resolveConfig({ apiKey: "sk-literal" }, { QUERIT_API_KEY: "sk-env" });
    expect(resolveQueritApiKey(config, { QUERIT_API_KEY: "sk-env" })).toBe("sk-env");
  });

  it("falls back to the apiKeyEnv variable", () => {
    const config = resolveConfig({}, { QUERIT_API_KEY: "  sk-env  " });
    expect(resolveQueritApiKey(config, { QUERIT_API_KEY: "  sk-env  " })).toBe("sk-env");
  });

  it("honors a custom apiKeyEnv name", () => {
    const config = resolveConfig({ apiKeyEnv: "MY_QUERIT_KEY" }, { MY_QUERIT_KEY: "sk-custom" });
    expect(resolveQueritApiKey(config, { MY_QUERIT_KEY: "sk-custom" })).toBe("sk-custom");
  });

  it("uses the literal apiKey option when no environment key is set", () => {
    const config = resolveConfig({ apiKey: "sk-literal" }, {});
    expect(resolveQueritApiKey(config, {})).toBe("sk-literal");
  });

  it("returns undefined when nothing is configured", () => {
    const config = resolveConfig({}, {});
    expect(resolveQueritApiKey(config, {})).toBeUndefined();
    expect(config.apiKeyEnv).toBe(DEFAULT_API_KEY_ENV);
  });
});
