# Querit + Browserbase

Discover authoritative web sources with Querit, then open and verify the selected source in a Browserbase cloud browser.

## Overview

The Querit + Browserbase reference integration separates web discovery from dynamic browser verification:

- **Querit** returns ranked, live search candidates with source URLs, snippets, site metadata, citation passages, and a search ID.
- **Browserbase** creates a managed Chromium session that renders the selected page through Playwright over CDP and preserves session logs and recording.

The included CLI joins those capabilities in a deterministic workflow. It selects the first valid result in Querit's order, rather than asking an LLM to choose a destination.

## How it works

```text
Search query
    │
    ▼
Querit Search ──► ranked candidates + citations
    │
    ▼ first safe public HTTP(S) result
Browserbase session ──► Playwright over CDP
    │
    ▼
final URL + page title + screenshot + session inspector URL
```

A successful run produces two complementary records:

1. **Discovery context** — the Querit result rank, title, URL, snippet, citation passages, site name, and search ID.
2. **Browser evidence** — the Browserbase session ID and inspector URL, the browser's final URL and rendered title, and a local PNG artifact.

The browser evidence confirms what the session reached and rendered during that run. It does not independently validate every claim made by the destination.

## When to use this workflow

Use this reference when an application needs to:

- begin with a natural-language search query rather than a known URL;
- retain citation metadata from the discovery step;
- render a JavaScript-capable page before recording evidence;
- review the resulting browser session in Browserbase; or
- test the entire handoff without introducing model variability.

The package uses injectable adapters, so teams can test selection, failure, output, and cleanup behavior without cloud credentials.

## Browserbase Search and Fetch

Browserbase provides its own [Search API](https://docs.browserbase.com/platform/search/overview) and [Fetch API](https://docs.browserbase.com/platform/fetch/overview), alongside full browser sessions. They are native choices when a workflow wants Browserbase search or lightweight page retrieval.

This reference demonstrates an alternative provider workflow: Querit is selected for authoritative discovery and citation details, while Browserbase is selected for dynamic browser verification. The approaches are complementary options; choose the one that matches the application's provider, metadata, and rendering requirements.

## Security model

- Credentials come only from `QUERIT_API_KEY` and `BROWSERBASE_API_KEY` in the process environment.
- No dotenv loader is included, and key values are not emitted in the JSON result.
- Known key values are redacted from CLI error messages.
- Search responses are untrusted input. The selector rejects malformed URLs, non-HTTP(S) schemes, URL credentials, localhost names, and literal private/reserved IP destinations.
- Browserbase's CDP connection URL is treated as sensitive and is never printed.
- Page and browser handles are closed in `finally` blocks. If CDP setup cannot complete, the code requests release of the created Browserbase session.

Apply destination-specific authorization, policy, and network controls before using the pattern in production.

## Included assets

- strict, Node 22-compatible TypeScript source;
- official `@browserbasehq/sdk` and `playwright-core` integration;
- an environment-only CLI;
- offline unit tests with injected adapters;
- an opt-in live smoke test;
- monorepo CI; and
- English usage documentation.

Continue to [Quickstart](quickstart.md).

## Resources

- [Browserbase Node.js SDK](https://docs.browserbase.com/reference/sdk/nodejs)
- [Create a Browserbase session](https://docs.browserbase.com/platform/browser/getting-started/create-browser-session)
- [Browserbase integration guide](https://docs.browserbase.com/integrations/get-started)
- [Playwright `connectOverCDP`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [Querit](https://www.querit.ai/)
