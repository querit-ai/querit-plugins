import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDemo } from "../src/demo.js";
import type {
  BrowserConnection,
  BrowserPage,
  DemoAdapters,
  SearchCandidate,
  SearchResponse,
} from "../src/types.js";

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "browserbase-querit-demo-"));
});

afterEach(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("runDemo", () => {
  it("stops before creating a browser session when Querit returns no results", async () => {
    const harness = createHarness({ results: [] });

    await expect(runDemo({
      artifactPath: join(temporaryDirectory, "evidence.png"),
      query: "official documentation",
    }, harness.adapters)).rejects.toMatchObject({ code: "NO_RESULTS" });

    expect(harness.createSession).not.toHaveBeenCalled();
    expect(harness.connect).not.toHaveBeenCalled();
  });

  it("rejects a result set containing only malformed or unsafe URLs", async () => {
    const harness = createHarness({
      results: [
        candidate({ url: "javascript:alert(1)" }),
        candidate({ url: "http://127.0.0.1/admin" }),
        candidate({ url: "not a URL" }),
      ],
    });

    await expect(runDemo({
      artifactPath: join(temporaryDirectory, "evidence.png"),
      query: "official documentation",
    }, harness.adapters)).rejects.toMatchObject({ code: "NO_SAFE_RESULT" });

    expect(harness.createSession).not.toHaveBeenCalled();
  });

  it("closes the page and browser when navigation fails", async () => {
    const harness = createHarness({
      gotoError: new Error("navigation failed"),
      results: [candidate()],
    });

    await expect(runDemo({
      artifactPath: join(temporaryDirectory, "evidence.png"),
      query: "official documentation",
    }, harness.adapters)).rejects.toMatchObject({
      code: "BROWSER_VERIFICATION_FAILED",
      message: "Browser verification failed: navigation failed",
    });

    expect(harness.pageClose).toHaveBeenCalledOnce();
    expect(harness.browserClose).toHaveBeenCalledOnce();
    expect(harness.releaseSession).not.toHaveBeenCalled();
  });

  it("requests session release when the CDP connection cannot be established", async () => {
    const harness = createHarness({
      connectError: new Error("CDP unavailable"),
      results: [candidate()],
    });

    await expect(runDemo({
      artifactPath: join(temporaryDirectory, "evidence.png"),
      query: "official documentation",
    }, harness.adapters)).rejects.toMatchObject({ code: "BROWSER_VERIFICATION_FAILED" });

    expect(harness.releaseSession).toHaveBeenCalledWith("session_test");
    expect(harness.pageClose).not.toHaveBeenCalled();
  });

  it("selects the first safe result and returns citation plus browser evidence", async () => {
    const artifactPath = join(temporaryDirectory, "evidence.png");
    const harness = createHarness({
      finalUrl: "https://example.com/docs/final",
      results: [
        candidate({ title: "Unsafe", url: "file:///etc/passwd" }),
        candidate({
          passages: ["Primary source passage.", "Second passage.", "Ignored passage."],
          publishedAt: "2026-08-01",
          siteName: "Example Docs",
          snippet: "Official reference material.",
          title: "Example documentation",
          url: "https://example.com/docs",
        }),
      ],
      title: "Rendered documentation",
    });

    const summary = await runDemo({ artifactPath, query: "official documentation" }, harness.adapters);

    expect(summary).toEqual({
      query: "official documentation",
      citation: {
        provider: "Querit",
        searchId: "search_123",
        rank: 2,
        title: "Example documentation",
        url: "https://example.com/docs",
        snippet: "Official reference material.",
        passages: ["Primary source passage.", "Second passage."],
        siteName: "Example Docs",
        publishedAt: "2026-08-01",
      },
      browserEvidence: {
        provider: "Browserbase",
        sessionId: "session_test",
        inspectorUrl: "https://www.browserbase.com/sessions/session_test",
        finalUrl: "https://example.com/docs/final",
        title: "Rendered documentation",
        screenshotPath: artifactPath.replaceAll("\\", "/"),
      },
    });
    await expect(readFile(artifactPath, "utf8")).resolves.toBe("fake-png");
    expect(harness.goto).toHaveBeenCalledWith("https://example.com/docs", {
      timeout: 45_000,
      waitUntil: "domcontentloaded",
    });
    expect(harness.pageClose).toHaveBeenCalledOnce();
    expect(harness.browserClose).toHaveBeenCalledOnce();
  });
});

interface HarnessOptions {
  connectError?: Error;
  finalUrl?: string;
  gotoError?: Error;
  results: SearchCandidate[];
  title?: string;
}

function createHarness(options: HarnessOptions) {
  const goto = vi.fn(async () => {
    if (options.gotoError) throw options.gotoError;
  });
  const pageClose = vi.fn(async () => undefined);
  const screenshot = vi.fn(async ({ path }: { path: string }) => {
    await writeFile(path, "fake-png");
  });
  const page: BrowserPage = {
    close: pageClose,
    goto,
    screenshot,
    title: vi.fn(async () => options.title ?? "Example"),
    url: vi.fn(() => options.finalUrl ?? "https://example.com/"),
  };

  const browserClose = vi.fn(async () => undefined);
  const browser: BrowserConnection = {
    close: browserClose,
    page: vi.fn(async () => page),
  };
  const connect = vi.fn(async () => {
    if (options.connectError) throw options.connectError;
    return browser;
  });
  const createSession = vi.fn(async () => ({
    connectUrl: "wss://connect.browserbase.test/session-token",
    id: "session_test",
  }));
  const releaseSession = vi.fn(async () => undefined);
  const searchResponse: SearchResponse = {
    query: "official documentation",
    results: options.results,
    searchId: "search_123",
  };
  const adapters: DemoAdapters = {
    search: { search: vi.fn(async () => searchResponse) },
    browserbase: { createSession, releaseSession },
    browser: { connect },
  };

  return {
    adapters,
    browserClose,
    connect,
    createSession,
    goto,
    pageClose,
    releaseSession,
  };
}

function candidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    passages: [],
    snippet: "Example snippet",
    title: "Example",
    url: "https://example.com",
    ...overrides,
  };
}
