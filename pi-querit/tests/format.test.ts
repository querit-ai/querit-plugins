import { readFile, rm } from "node:fs/promises";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { formatContentsResponse, formatSearchResponse, truncateUtf8 } from "../src/format.js";
import { limitToolOutput } from "../src/output.js";
import { sanitizeTerminalText } from "../src/sanitize.js";

describe("response formatting", () => {
  it("keeps source URLs and marks search data as untrusted", () => {
    const text = formatSearchResponse({
      query: "current news",
      searchId: "9007199254740993123",
      results: [{
        title: "Example",
        url: "https://example.com/article",
        snippet: "A result snippet",
        siteName: "Example",
        pageAge: "1 day ago",
        sentences: ["First excerpt"],
      }],
    });

    expect(text).toContain("untrusted web data");
    expect(text).toContain("https://example.com/article");
    expect(text).toContain("9007199254740993123");
    expect(text).toContain("First excerpt");
  });

  it("formats returned and unavailable content URLs", () => {
    const text = formatContentsResponse({
      searchId: "123",
      results: [{
        url: "https://example.com/",
        content: "# Page body",
        metadata: { title: "Example page" },
      }],
      statuses: [{ id: "1", status: "success" }, { id: "2", status: "failed" }],
      searchTime: 2,
    }, ["https://example.com/", "https://missing.example/"], "markdown");

    expect(text).toContain("BEGIN UNTRUSTED PAGE CONTENT");
    expect(text).toContain("# Page body");
    expect(text).toContain("https://missing.example/");
  });

  it("truncates UTF-8 without exceeding the byte budget", () => {
    const value = "你".repeat(100);
    const truncated = truncateUtf8(value, 32);
    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(32);
    expect(truncated).toMatch(/\.\.\.$/);
    expect(truncated).not.toContain("�");
  });

  it("removes terminal control sequences from untrusted web data", () => {
    const dangerous = "\u001b]52;c;clipboard\u0007Visible \u001b[31mred\u001b[0m\u0008 text\u202e";
    const sanitized = sanitizeTerminalText(dangerous);
    expect(sanitized).toBe("Visible red text");
    expect(sanitized).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);

    const searchText = formatSearchResponse({
      query: "safe",
      searchId: "\u009b31m123\u009b0m",
      results: [{
        title: dangerous,
        url: "https://example.com/",
        snippet: "\u001b[2Jsnippet",
        sentences: ["\u009b31mexcerpt\u009b0m"],
      }],
    });
    const contentsText = formatContentsResponse({
      searchId: "\u001b]0;owned\u0007456",
      results: [{ url: "https://example.com/", content: "\u001b]0;owned\u0007Body" }],
      statuses: [],
    }, ["https://example.com/"], "markdown");
    expect(searchText).not.toMatch(/[\u001b\u0080-\u009f]/u);
    expect(searchText).toContain("Search ID: 123");
    expect(searchText).toContain("Visible red text");
    expect(searchText).toContain("snippet");
    expect(contentsText).toContain("Body");
    expect(contentsText).not.toMatch(/[\u001b\u0080-\u009f]/u);
    expect(contentsText).toContain("Search ID: 456");
  });

  it("saves complete output when Pi's tool limit is exceeded", async () => {
    const output = Array.from({ length: 3_000 }, (_, index) => `${index}: ${"x".repeat(30)}`).join("\n");
    const limited = await limitToolOutput(output, "test-output.md");

    expect(limited.truncation?.truncated).toBe(true);
    expect(limited.text).toContain("Output truncated");
    expect(Buffer.byteLength(limited.text, "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
    expect(limited.text.split("\n").length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(limited.fullOutputPath).toBeTruthy();
    expect(await readFile(limited.fullOutputPath!, "utf8")).toBe(output);
    await rm(limited.fullOutputPath!, { force: true });

    const lineOnlyOutput = Array.from({ length: 2_100 }, () => "x").join("\n");
    const lineLimited = await limitToolOutput(lineOnlyOutput, "line-output.md");
    expect(Buffer.byteLength(lineLimited.text, "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
    expect(lineLimited.text.split("\n").length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(await readFile(lineLimited.fullOutputPath!, "utf8")).toBe(lineOnlyOutput);
    await rm(lineLimited.fullOutputPath!, { force: true });
  });
});
