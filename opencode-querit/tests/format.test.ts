import { describe, expect, it } from "vitest";
import type { QueritContentsResponse } from "../src/client.js";
import { capOutput, formatContentsResponse, truncateUtf8 } from "../src/format.js";

const contentsResponse: QueritContentsResponse = {
  searchId: "7",
  results: [
    {
      id: "1",
      url: "https://example.com/page",
      content: "page body \u202e(bidi override)\u202c",
      highlights: ["the \u001b[31mkey fact\u001b[0m"],
      metadata: { title: "Page title", siteName: "Example Site", publishTime: "2026-08-01" },
    },
  ],
  statuses: [{ id: "1", status: "success" }, { id: "2", status: "failed" }],
  searchTime: 3.2,
};

describe("formatContentsResponse", () => {
  it("renders the warning header, summary, highlights, and page content", () => {
    const output = formatContentsResponse(contentsResponse, ["https://example.com/page"], "markdown");
    expect(output).toContain("untrusted web data");
    expect(output).toContain("# Querit fetched contents\nRequested: 1 | Returned: 1 | Successful: 1 | Failed: 1 | Server time: 3.2s | Search ID: 7");
    expect(output).toContain("## 1. Page title");
    expect(output).toContain("URL: https://example.com/page");
    expect(output).toContain("Site: Example Site");
    expect(output).toContain("Published: 2026-08-01");
    expect(output).toContain("Highlights:\n- the key fact");
    expect(output).toContain("--- BEGIN UNTRUSTED PAGE CONTENT ---");
    expect(output).toContain("page body (bidi override)");
    expect(output).toContain("--- END UNTRUSTED PAGE CONTENT ---");
    expect(output).not.toContain("URLs without returned content");
  });

  it("never renders a cost Querit did not report", () => {
    const output = formatContentsResponse(contentsResponse, ["https://example.com/page"], "markdown");
    expect(output).not.toContain("Cost");
  });

  it("renders a reported cost with six decimals, including a reported zero", () => {
    const charged = formatContentsResponse(
      { ...contentsResponse, cost: { currency: "USD", total: 0.001 } },
      ["https://example.com/page"],
      "markdown",
    );
    expect(charged).toContain("Search ID: 7 | Cost: USD 0.001000");

    const free = formatContentsResponse(
      { ...contentsResponse, cost: { currency: "USD", total: 0 } },
      ["https://example.com/page"],
      "markdown",
    );
    expect(free).toContain("Cost: USD 0.000000");
  });

  it("lists requested URLs that returned no content", () => {
    const output = formatContentsResponse(
      contentsResponse,
      ["https://example.com/page", "https://example.com/missing"],
      "text",
    );
    expect(output).toContain("## URLs without returned content");
    expect(output).toContain("- https://example.com/missing");
    // A status without a result is still counted; nothing is matched by array position.
    expect(output).toContain("Returned: 1 | Successful: 1 | Failed: 1");
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
