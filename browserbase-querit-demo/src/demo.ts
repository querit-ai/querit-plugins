import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve, sep } from "node:path";
import { browserbaseInspectorUrl } from "./browserbase.js";
import { IntegrationError, wrapIntegrationError } from "./errors.js";
import { normalizeSafeWebUrl, sanitizeText } from "./security.js";
import type {
  BrowserConnection,
  BrowserPage,
  BrowserSession,
  DemoAdapters,
  DemoOptions,
  DemoSummary,
  SearchCandidate,
  SearchResponse,
} from "./types.js";

const DEFAULT_ARTIFACT_PATH = "artifacts/evidence.png";
const DEFAULT_NAVIGATION_TIMEOUT_MS = 45_000;
const MAX_QUERY_LENGTH = 500;

interface SelectedCandidate {
  candidate: SearchCandidate;
  rank: number;
  url: string;
}

export async function runDemo(options: DemoOptions, adapters: DemoAdapters): Promise<DemoSummary> {
  const query = normalizeQuery(options.query);
  const navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
  if (!Number.isInteger(navigationTimeoutMs) || navigationTimeoutMs <= 0) {
    throw new IntegrationError("INVALID_CONFIGURATION", "Navigation timeout must be a positive integer.");
  }

  let searchResponse: SearchResponse;
  try {
    searchResponse = await adapters.search.search(query);
  } catch (error) {
    throw wrapIntegrationError("QUERIT_API_ERROR", "Querit discovery failed", error);
  }

  const selected = selectFirstSafeCandidate(searchResponse);
  const requestedArtifactPath = options.artifactPath ?? DEFAULT_ARTIFACT_PATH;
  if (!requestedArtifactPath.trim()) {
    throw new IntegrationError("INVALID_CONFIGURATION", "Artifact path must not be empty.");
  }

  const absoluteArtifactPath = resolve(requestedArtifactPath);
  await mkdir(dirname(absoluteArtifactPath), { recursive: true });

  let session: BrowserSession;
  try {
    session = await adapters.browserbase.createSession();
  } catch (error) {
    throw wrapIntegrationError("BROWSERBASE_API_ERROR", "Browserbase session creation failed", error);
  }

  let browser: BrowserConnection | undefined;
  let browserClosed = false;
  let activeError: unknown;

  try {
    try {
      browser = await adapters.browser.connect(session.connectUrl);
      let page: BrowserPage | undefined;
      let pageError: unknown;

      try {
        page = await browser.page();
        await page.goto(selected.url, {
          timeout: navigationTimeoutMs,
          waitUntil: "domcontentloaded",
        });

        const finalUrl = normalizeSafeWebUrl(page.url());
        if (!finalUrl) {
          throw new IntegrationError(
            "BROWSER_VERIFICATION_FAILED",
            "Browser navigation ended at a malformed or unsafe URL.",
          );
        }

        const title = sanitizeText(await page.title(), 300);
        await page.screenshot({
          fullPage: true,
          path: absoluteArtifactPath,
        });

        return buildSummary(
          query,
          searchResponse,
          selected,
          session.id,
          finalUrl,
          title,
          displayPath(requestedArtifactPath, absoluteArtifactPath),
        );
      } catch (error) {
        pageError = error;
        throw error;
      } finally {
        if (page) {
          try {
            await page.close();
          } catch (error) {
            if (pageError === undefined) {
              throw wrapIntegrationError(
                "BROWSER_CLEANUP_FAILED",
                "Could not close the Playwright page",
                error,
                [session.connectUrl],
              );
            }
          }
        }
      }
    } catch (error) {
      activeError = error;
      throw wrapIntegrationError(
        "BROWSER_VERIFICATION_FAILED",
        "Browser verification failed",
        error,
        [session.connectUrl],
      );
    } finally {
      if (browser) {
        try {
          await browser.close();
          browserClosed = true;
        } catch (error) {
          if (activeError === undefined) {
            activeError = error;
            throw wrapIntegrationError(
              "BROWSER_CLEANUP_FAILED",
              "Could not close the Playwright browser",
              error,
              [session.connectUrl],
            );
          }
        }
      }
    }
  } finally {
    if (!browserClosed) {
      try {
        await adapters.browserbase.releaseSession(session.id);
      } catch (error) {
        if (activeError === undefined) {
          throw wrapIntegrationError(
            "BROWSER_CLEANUP_FAILED",
            "Could not release the Browserbase session",
            error,
          );
        }
      }
    }
  }
}

export function selectFirstSafeCandidate(response: SearchResponse): SelectedCandidate {
  if (response.results.length === 0) {
    throw new IntegrationError("NO_RESULTS", "Querit returned no search results.");
  }

  for (const [index, candidate] of response.results.entries()) {
    const url = normalizeSafeWebUrl(candidate.url);
    if (url) return { candidate, rank: index + 1, url };
  }

  throw new IntegrationError(
    "NO_SAFE_RESULT",
    "Querit returned results, but none contained a safe public HTTP(S) URL.",
  );
}

function buildSummary(
  query: string,
  response: SearchResponse,
  selected: SelectedCandidate,
  sessionId: string,
  finalUrl: string,
  title: string,
  screenshotPath: string,
): DemoSummary {
  const siteName = selected.candidate.siteName
    ? sanitizeText(selected.candidate.siteName, 200)
    : undefined;
  const publishedAt = selected.candidate.publishedAt
    ? sanitizeText(selected.candidate.publishedAt, 100)
    : undefined;

  return {
    query: sanitizeText(query, MAX_QUERY_LENGTH),
    citation: {
      provider: "Querit",
      searchId: response.searchId ? sanitizeText(response.searchId, 200) : null,
      rank: selected.rank,
      title: sanitizeText(selected.candidate.title, 300),
      url: selected.url,
      snippet: sanitizeText(selected.candidate.snippet, 500),
      passages: selected.candidate.passages.slice(0, 2).map((passage) => sanitizeText(passage, 500)),
      ...(siteName ? { siteName } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    },
    browserEvidence: {
      provider: "Browserbase",
      sessionId: sanitizeText(sessionId, 200),
      inspectorUrl: browserbaseInspectorUrl(sessionId),
      finalUrl,
      title,
      screenshotPath,
    },
  };
}

function normalizeQuery(value: string): string {
  const query = value.trim();
  if (!query) throw new IntegrationError("INVALID_QUERY", "Provide a non-empty search query.");
  if (query.length > MAX_QUERY_LENGTH) {
    throw new IntegrationError(
      "INVALID_QUERY",
      `Search query must be at most ${MAX_QUERY_LENGTH} characters.`,
    );
  }
  return sanitizeText(query, MAX_QUERY_LENGTH);
}

function displayPath(requestedPath: string, absolutePath: string): string {
  const path = isAbsolute(requestedPath) ? absolutePath : normalize(requestedPath);
  return sep === "/" ? path : path.split(sep).join("/");
}
