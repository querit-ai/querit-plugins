import { describe, expect, it } from "vitest";
import type { QueritContentsResponse, QueritSearchResponse, QueritSearchResult } from "../src/client.js";
import { capOutput, formatContentsResponse, formatSearchResponse, safeSlice, truncateUtf8 } from "../src/format.js";

const searchResult: QueritSearchResult = {
  title: "Example result",
  url: "https://example.com/a",
  snippet: "A snippet with \u001b[31mANSI\u001b[0m and control\u0007 chars",
  pageAge: "2d",
  siteName: "Example",
  sentences: ["sentence one", "sentence two"],
  highlights: ["relevant \u001b[31mfragment\u001b[0m"],
};

const searchResponse: QueritSearchResponse = {
  searchId: "42",
  took: "0.5s",
  query: "live web search",
  results: [searchResult],
};

describe("formatSearchResponse", () => {
  it("renders source fields, highlights, and an untrusted-data warning", () => {
    const output = formatSearchResponse(searchResponse);
    expect(output).toContain("untrusted web data");
    expect(output).toContain("# Querit search results for: live web search");
    expect(output).toContain("Results: 1 | Server time: 0.5s | Search ID: 42");
    expect(output).toContain("## 1. Example result");
    expect(output).toContain("URL: https://example.com/a");
    expect(output).toContain("Source: Example");
    expect(output).toContain("Page age (UTC): 2d");
    expect(output).toContain("Snippet: A snippet with ANSI and control chars");
    expect(output).toContain("Highlights:\n- relevant fragment");
    expect(output).not.toContain("\u001b");
  });

  it("renders body text when no Markdown variant was requested", () => {
    const output = formatSearchResponse({ query: "live web search", results: [{ ...searchResult, highlights: [] }] });
    expect(output).toContain("Content excerpts:\n- sentence one\n- sentence two");
    expect(output).not.toContain("Highlights:");
  });

  it("prefers Markdown snippets and body text when they are present", () => {
    const output = formatSearchResponse({
      query: "live web search",
      results: [{
        ...searchResult,
        snippetMarkdown: ["**A**", "**B**"],
        contentMarkdown: "# Body \u001b[2Jtext",
      }],
    });
    expect(output).toContain("Snippet: **A** **B**");
    expect(output).toContain("Content (Markdown):\n# Body text");
    expect(output).not.toContain("A snippet with ANSI");
    expect(output).not.toContain("Content excerpts:");
    expect(output).not.toContain("\u001b");
  });

  it("shows a reported cost at six decimals and nothing when cost is unavailable", () => {
    const costed = formatSearchResponse({ ...searchResponse, cost: { currency: "USD", total: 0.000123 } });
    expect(costed).toContain("Search ID: 42 | Cost: USD 0.000123");

    const zero = formatSearchResponse({ ...searchResponse, cost: { currency: "USD", total: 0 } });
    expect(zero).toContain("Search ID: 42 | Cost: USD 0.000000");

    expect(formatSearchResponse(searchResponse)).not.toContain("Cost:");
  });

  it("notes a rank preference that was withheld for the code vertical", () => {
    const noted = formatSearchResponse(searchResponse, { rankDropped: true });
    expect(noted).toContain("Note: the rank preference was not applied because Querit rejects rank for the code vertical.");
    expect(formatSearchResponse(searchResponse)).not.toContain("rank preference");
    expect(formatSearchResponse(searchResponse, { rankDropped: false })).not.toContain("rank preference");
  });

  it("handles empty results", () => {
    expect(formatSearchResponse({ query: "nothing", results: [] })).toContain("No results found.");
  });
});

describe("formatContentsResponse", () => {
  const response: QueritContentsResponse = {
    searchId: "7",
    cost: { currency: "USD", total: 0.02 },
    results: [{
      id: "1",
      url: "https://example.com/page",
      content: "page body \u202e(bidi override)\u202c",
      highlights: ["page \u001b[31mbody\u001b[0m"],
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

  it("shows cost next to the search ID and highlights above the page content", () => {
    const output = formatContentsResponse(response, ["https://example.com/page"], "markdown");
    expect(output).toContain("Server time: 3.2s | Search ID: 7 | Cost: USD 0.020000");
    expect(output).toContain("Highlights:\n- page body");
    expect(output.indexOf("Highlights:")).toBeLessThan(output.indexOf("--- BEGIN UNTRUSTED PAGE CONTENT ---"));
    expect(output).not.toContain("\u001b");
  });

  it("omits the cost and highlights segments when none were returned", () => {
    const plain = formatContentsResponse(
      { results: [{ url: "https://example.com/page", content: "page body", highlights: [] }], statuses: [] },
      ["https://example.com/page"],
      "text",
    );
    expect(plain).not.toContain("Cost:");
    expect(plain).not.toContain("Highlights:");
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
