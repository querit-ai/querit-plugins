import { describe, expect, it } from "vitest";
import type { QueritContentsResponse, QueritSearchResponse } from "../src/client.js";
import { capOutput, formatContentsResponse, formatSearchResponse, truncateUtf8 } from "../src/format.js";

const searchResponse: QueritSearchResponse = {
  searchId: "42",
  took: "0.5s",
  query: "live web search",
  results: [
    {
      title: "Example result",
      url: "https://example.com/a",
      snippet: "A snippet with \u001b[31mANSI\u001b[0m and control\u0007 chars",
      pageAge: "2d",
      siteName: "Ex",
      sentences: ["sentence one", "sentence two"],
    },
  ],
};

describe("formatSearchResponse", () => {
  it("renders the untrusted-data warning and result fields", () => {
    const output = formatSearchResponse(searchResponse);
    expect(output).toContain("untrusted web data");
    expect(output).toContain("# Querit search results for: live web search");
    expect(output).toContain("Results: 1 | Server time: 0.5s | Search ID: 42");
    expect(output).toContain("## 1. Example result");
    expect(output).toContain("URL: https://example.com/a");
    expect(output).toContain("Source: Ex | 2d");
    expect(output).toContain("Snippet: A snippet with ANSI and control chars");
    expect(output).toContain("- sentence one");
    expect(output).toContain("- sentence two");
  });

  it("handles empty results", () => {
    const output = formatSearchResponse({ query: "nothing", results: [] });
    expect(output).toContain("Results: 0");
    expect(output).toContain("No results found.");
  });
});

const contentsResponse: QueritContentsResponse = {
  searchId: "7",
  results: [
    {
      id: "1",
      url: "https://example.com/page",
      content: "page body \u202e(bidi override)\u202c",
      metadata: { title: "Page title", siteName: "Example Site", publishTime: "2026-08-01" },
    },
  ],
  statuses: [{ id: "1", status: "success" }, { id: "2", status: "failed" }],
  searchTime: 3.2,
};

describe("formatContentsResponse", () => {
  it("renders the warning header, statuses, and page content", () => {
    const output = formatContentsResponse(contentsResponse, ["https://example.com/page"], "markdown");
    expect(output).toContain("untrusted web data");
    expect(output).toContain("Requested: 1 | Returned: 1 | Successful: 1 | Failed: 1 | Server time: 3.2s | Search ID: 7");
    expect(output).toContain("## 1. Page title");
    expect(output).toContain("URL: https://example.com/page");
    expect(output).toContain("Site: Example Site");
    expect(output).toContain("Published: 2026-08-01");
    expect(output).toContain("--- BEGIN UNTRUSTED PAGE CONTENT ---");
    expect(output).toContain("page body (bidi override)");
    expect(output).toContain("--- END UNTRUSTED PAGE CONTENT ---");
    expect(output).not.toContain("URLs without returned content");
  });

  it("lists requested URLs that returned no content", () => {
    const output = formatContentsResponse(contentsResponse, ["https://example.com/page", "https://example.com/missing"], "text");
    expect(output).toContain("## URLs without returned content");
    expect(output).toContain("- https://example.com/missing");
  });
});

describe("truncateUtf8", () => {
  it("returns short values unchanged", () => {
    expect(truncateUtf8("short", 100)).toBe("short");
  });

  it("truncates long values with an ellipsis", () => {
    expect(truncateUtf8("abcdefghij", 6)).toBe("abc...");
  });

  it("does not split multi-byte characters", () => {
    const emoji = "🙂".repeat(4);
    expect(truncateUtf8(emoji, 7)).toBe("🙂...");
  });
});

describe("capOutput", () => {
  it("returns the text unchanged when under the cap", () => {
    expect(capOutput("hello", 10)).toBe("hello");
  });

  it("caps oversized output with an ellipsis", () => {
    expect(capOutput("hello world", 8)).toBe("hello...");
  });
});
