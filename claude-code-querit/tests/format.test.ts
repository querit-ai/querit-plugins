import { describe, expect, it } from "vitest";
import type { QueritContentsResponse, QueritSearchResponse } from "../src/client.js";
import { capOutput, formatContentsResponse, formatSearchResponse, safeSlice, truncateUtf8 } from "../src/format.js";

const searchResponse: QueritSearchResponse = {
  searchId: "42",
  took: "0.5s",
  query: "live web search",
  results: [{
    title: "Example result",
    url: "https://example.com/a",
    snippet: "A snippet with \u001b[31mANSI\u001b[0m and control\u0007 chars",
    pageAge: "2d",
    siteName: "Example",
    sentences: ["sentence one", "sentence two"],
  }],
};

describe("formatSearchResponse", () => {
  it("renders source fields and an untrusted-data warning", () => {
    const output = formatSearchResponse(searchResponse);
    expect(output).toContain("untrusted web data");
    expect(output).toContain("# Querit search results for: live web search");
    expect(output).toContain("Results: 1 | Server time: 0.5s | Search ID: 42");
    expect(output).toContain("## 1. Example result");
    expect(output).toContain("URL: https://example.com/a");
    expect(output).toContain("Source: Example | 2d");
    expect(output).toContain("Snippet: A snippet with ANSI and control chars");
    expect(output).not.toContain("\u001b");
  });

  it("handles empty results", () => {
    expect(formatSearchResponse({ query: "nothing", results: [] })).toContain("No results found.");
  });
});

describe("formatContentsResponse", () => {
  const response: QueritContentsResponse = {
    searchId: "7",
    results: [{
      id: "1",
      url: "https://example.com/page",
      content: "page body \u202e(bidi override)\u202c",
      metadata: { title: "Page title", siteName: "Example", publishTime: "2026-08-01" },
    }],
    statuses: [{ id: "1", status: "success" }, { id: "2", status: "failed" }],
    searchTime: 3.2,
  };

  it("delimits and sanitizes untrusted page content", () => {
    const output = formatContentsResponse(response, ["https://example.com/page"], "markdown");
    expect(output).toContain("untrusted web data");
    expect(output).toContain("Requested: 1 | Returned: 1 | Successful: 1 | Failed: 1");
    expect(output).toContain("--- BEGIN UNTRUSTED PAGE CONTENT ---");
    expect(output).toContain("page body (bidi override)");
    expect(output).toContain("--- END UNTRUSTED PAGE CONTENT ---");
    expect(output).not.toContain("\u202e");
  });

  it("lists URLs without returned content", () => {
    const output = formatContentsResponse(
      response,
      ["https://example.com/page", "https://example.com/missing"],
      "text",
    );
    expect(output).toContain("## URLs without returned content");
    expect(output).toContain("- https://example.com/missing");
  });
});

describe("output limits", () => {
  it("truncates UTF-8 without splitting a code point", () => {
    expect(truncateUtf8("🙂".repeat(4), 7)).toBe("🙂...");
  });

  it("caps output with an explicit marker", () => {
    const output = capOutput("x".repeat(100), 64);
    expect(output).toHaveLength(64);
    expect(output).toContain("Output truncated by the Querit plugin");
  });

  it("does not leave a dangling high surrogate", () => {
    expect(safeSlice("a🙂b", 2)).toBe("a");
  });
});
