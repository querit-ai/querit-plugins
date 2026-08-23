import { describe, expect, it } from "vitest";
import { normalizeSafeWebUrl, redactSecrets } from "../src/security.js";

describe("normalizeSafeWebUrl", () => {
  it.each([
    "not a URL",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:password@example.com",
    "http://localhost/admin",
    "http://service.internal/admin",
    "http://127.0.0.1/admin",
    "http://0x7f000001/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1",
    "http://192.168.1.1",
    "http://[::1]",
    "http://[::7f00:1]",
    "http://[::ffff:7f00:1]",
  ])("rejects unsafe URL %s", (url) => {
    expect(normalizeSafeWebUrl(url)).toBeUndefined();
  });

  it("canonicalizes a public HTTP(S) URL", () => {
    expect(normalizeSafeWebUrl(" https://example.com/docs?q=browser ")).toBe(
      "https://example.com/docs?q=browser",
    );
  });
});

describe("redactSecrets", () => {
  it("removes every secret occurrence and terminal control sequence", () => {
    expect(redactSecrets("\u001b[31mbad secret-value / secret-value\u001b[0m", ["secret-value"]))
      .toBe("bad [REDACTED] / [REDACTED]");
  });
});
