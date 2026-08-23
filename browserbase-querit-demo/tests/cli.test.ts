import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import type { DemoAdapters } from "../src/types.js";

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "browserbase-querit-cli-"));
});

afterEach(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("runCli", () => {
  it("prints usage and required environment variables", async () => {
    const stdout = captureOutput();
    const stderr = captureOutput();

    const exitCode = await runCli({ args: ["--help"], env: {}, stderr, stdout });

    expect(exitCode).toBe(0);
    expect(stderr.text()).toBe("");
    expect(stdout.text()).toContain("Usage: npm start");
    expect(stdout.text()).toContain("QUERIT_API_KEY");
    expect(stdout.text()).toContain("BROWSERBASE_API_KEY");
  });

  it("writes one JSON result with Querit citations and browser evidence", async () => {
    const stdout = captureOutput();
    const stderr = captureOutput();
    const adapterFactory = vi.fn(() => successfulAdapters());
    const artifactPath = join(temporaryDirectory, "evidence.png");

    const exitCode = await runCli({
      adapterFactory,
      args: ["official", "browser", "documentation"],
      artifactPath,
      env: {
        BROWSERBASE_API_KEY: "browserbase-test-key",
        QUERIT_API_KEY: "querit-test-key",
      },
      stderr,
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(stderr.text()).toBe("");
    expect(adapterFactory).toHaveBeenCalledWith({
      browserbaseApiKey: "browserbase-test-key",
      queritApiKey: "querit-test-key",
    });

    const output = JSON.parse(stdout.text()) as Record<string, unknown>;
    expect(output).toMatchObject({
      query: "official browser documentation",
      citation: {
        provider: "Querit",
        rank: 1,
        searchId: "search_456",
        title: "Authoritative source",
        url: "https://example.com/reference",
      },
      browserEvidence: {
        finalUrl: "https://example.com/reference",
        inspectorUrl: "https://www.browserbase.com/sessions/session_456",
        provider: "Browserbase",
        screenshotPath: artifactPath.replaceAll("\\", "/"),
        sessionId: "session_456",
        title: "Verified source",
      },
    });
    expect(stdout.text()).not.toContain("querit-test-key");
    expect(stdout.text()).not.toContain("browserbase-test-key");
  });

  it("redacts both environment keys from errors", async () => {
    const stdout = captureOutput();
    const stderr = captureOutput();
    const queritApiKey = "querit-secret";
    const browserbaseApiKey = "browserbase-secret";
    const adapters = successfulAdapters();
    adapters.search.search = vi.fn(async () => {
      throw new Error(`API rejected ${queritApiKey} and ${browserbaseApiKey}`);
    });

    const exitCode = await runCli({
      adapterFactory: () => adapters,
      args: ["query"],
      artifactPath: join(temporaryDirectory, "evidence.png"),
      env: {
        BROWSERBASE_API_KEY: browserbaseApiKey,
        QUERIT_API_KEY: queritApiKey,
      },
      stderr,
      stdout,
    });

    expect(exitCode).toBe(1);
    expect(stdout.text()).toBe("");
    expect(stderr.text()).not.toContain(queritApiKey);
    expect(stderr.text()).not.toContain(browserbaseApiKey);
    expect(stderr.text()).toContain("[REDACTED]");
    expect(JSON.parse(stderr.text())).toMatchObject({
      error: { code: "QUERIT_API_ERROR" },
    });
  });

  it("reports missing environment variable names without reading a dotenv file", async () => {
    const stderr = captureOutput();

    const exitCode = await runCli({
      args: ["query"],
      env: {},
      stderr,
      stdout: captureOutput(),
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr.text())).toEqual({
      error: {
        code: "INVALID_CONFIGURATION",
        message: "Missing required environment variables: QUERIT_API_KEY, BROWSERBASE_API_KEY.",
      },
    });
  });
});

function successfulAdapters(): DemoAdapters {
  return {
    search: {
      search: vi.fn(async (query: string) => ({
        query,
        searchId: "search_456",
        results: [{
          passages: ["Source passage"],
          snippet: "Source snippet",
          title: "Authoritative source",
          url: "https://example.com/reference",
        }],
      })),
    },
    browserbase: {
      createSession: vi.fn(async () => ({
        connectUrl: "wss://connect.browserbase.test/session-token",
        id: "session_456",
      })),
      releaseSession: vi.fn(async () => undefined),
    },
    browser: {
      connect: vi.fn(async () => ({
        close: vi.fn(async () => undefined),
        page: vi.fn(async () => ({
          close: vi.fn(async () => undefined),
          goto: vi.fn(async () => undefined),
          screenshot: vi.fn(async ({ path }: { path: string }) => {
            await writeFile(path, "fake-png");
          }),
          title: vi.fn(async () => "Verified source"),
          url: vi.fn(() => "https://example.com/reference"),
        })),
      })),
    },
  };
}

function captureOutput() {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
    },
    text() {
      return chunks.join("");
    },
  };
}
