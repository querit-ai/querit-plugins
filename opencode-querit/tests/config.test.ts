import { describe, expect, it } from "vitest";
import {
  BASE_URL_ENV,
  DEFAULT_API_KEY_ENV,
  resolveConfig,
  resolveQueritApiKey,
} from "../src/config.js";

describe("resolveConfig", () => {
  it("applies defaults for every field", () => {
    const config = resolveConfig({}, {});
    expect(config.apiKey).toBeUndefined();
    expect(config.apiKeyEnv).toBe("QUERIT_API_KEY");
    expect(config.baseURL).toBe("https://api.querit.ai");
    expect(config.timeoutMs).toBe(70_000);
    expect(config.count).toBe(5);
    expect(config.timeRange).toBeUndefined();
    expect(config.countries).toEqual([]);
    expect(config.languages).toEqual([]);
    expect(config.includeDomains).toEqual([]);
    expect(config.excludeDomains).toEqual([]);
    expect(config.includeContent).toBe(false);
    expect(config.chunksPerDoc).toBe(1);
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
      languages: ["english"],
      includeDomains: ["github.com"],
      excludeDomains: ["pinterest.com", "facebook.com", "instagram.com", "tiktok.com"],
      includeContent: true,
      chunksPerDoc: 2,
      fetchFormat: "html",
      fetchCrawlTimeout: 20,
      fetchMaxChars: 1_000,
      maxOutputChars: 50_000,
    });
    expect(config.apiKey).toBe("sk-123");
    expect(config.baseURL).toBe("https://proxy.example");
    expect(config.timeoutMs).toBe(42_000);
    expect(config.count).toBe(8);
    expect(config.timeRange).toBe("m3");
    expect(config.countries).toEqual(["united states", "japan"]);
    expect(config.languages).toEqual(["english"]);
    expect(config.includeDomains).toEqual(["github.com"]);
    expect(config.excludeDomains).toHaveLength(4);
    expect(config.includeContent).toBe(true);
    expect(config.chunksPerDoc).toBe(2);
    expect(config.fetchFormat).toBe("html");
    expect(config.fetchCrawlTimeout).toBe(20);
    expect(config.fetchMaxChars).toBe(1_000);
    expect(config.maxOutputChars).toBe(50_000);
  });

  it("falls back to QUERIT_BASE_URL from the environment", () => {
    const config = resolveConfig({}, { [BASE_URL_ENV]: "https://env.example/" });
    expect(config.baseURL).toBe("https://env.example");
  });

  it("normalizes domains to bare hostnames", () => {
    const config = resolveConfig({
      includeDomains: ["https://Github.com/path", "stackoverflow.com"],
    });
    expect(config.includeDomains).toEqual(["github.com", "stackoverflow.com"]);
  });

  it("throws on an invalid base URL", () => {
    expect(() => resolveConfig({ baseURL: "not a url" }, {})).toThrow("baseURL");
  });

  it("throws on unknown countries and languages", () => {
    expect(() => resolveConfig({ countries: ["atlantis"] }, {})).toThrow("countries");
    expect(() => resolveConfig({ languages: ["klingon"] }, {})).toThrow("languages");
  });

  it("throws on out-of-range numeric options", () => {
    expect(() => resolveConfig({ count: 21 }, {})).toThrow("count");
    expect(() => resolveConfig({ count: 0 }, {})).toThrow("count");
    expect(() => resolveConfig({ chunksPerDoc: 4 }, {})).toThrow("chunksPerDoc");
    expect(() => resolveConfig({ fetchCrawlTimeout: 61 }, {})).toThrow("fetchCrawlTimeout");
    expect(() => resolveConfig({ timeoutMs: 500 }, {})).toThrow("timeoutMs");
    expect(() => resolveConfig({ fetchMaxChars: 10 }, {})).toThrow("fetchMaxChars");
  });

  it("throws on an invalid timeRange", () => {
    expect(() => resolveConfig({ timeRange: "last week" }, {})).toThrow("timeRange");
  });
});

describe("resolveQueritApiKey", () => {
  it("prefers the literal apiKey option", () => {
    const config = resolveConfig({ apiKey: "sk-literal" }, { QUERIT_API_KEY: "sk-env" });
    expect(resolveQueritApiKey(config)).toBe("sk-literal");
  });

  it("falls back to the apiKeyEnv variable", () => {
    const config = resolveConfig({}, { QUERIT_API_KEY: "  sk-env  " });
    expect(resolveQueritApiKey(config, { QUERIT_API_KEY: "  sk-env  " })).toBe("sk-env");
  });

  it("honors a custom apiKeyEnv name", () => {
    const config = resolveConfig({ apiKeyEnv: "MY_QUERIT_KEY" }, { MY_QUERIT_KEY: "sk-custom" });
    expect(resolveQueritApiKey(config, { MY_QUERIT_KEY: "sk-custom" })).toBe("sk-custom");
  });

  it("returns undefined when nothing is configured", () => {
    const config = resolveConfig({}, {});
    expect(resolveQueritApiKey(config)).toBeUndefined();
    expect(config.apiKeyEnv).toBe(DEFAULT_API_KEY_ENV);
  });
});
