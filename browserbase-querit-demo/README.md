# Browserbase × Querit demo

A standalone, runnable TypeScript demo that uses [Querit](https://www.querit.ai/) to discover an authoritative source and [Browserbase](https://www.browserbase.com/) to verify that source in a cloud browser.

This repository asset is **not an installable Browserbase plugin**. It is a deterministic, no-LLM reference integration for the Browserbase partner/integration catalog.

## What it does

Given one CLI search query, the demo:

1. calls Querit Search for citation-bearing candidates;
2. selects the first candidate with a safe public HTTP(S) URL;
3. creates a recorded Browserbase session;
4. connects with `playwright-core` over CDP;
5. opens the selected URL and captures its final URL, rendered title, and a full-page PNG;
6. closes the page and browser in `finally` blocks; and
7. prints one concise JSON object containing the Querit citation and Browserbase evidence.

No model is called and no result is chosen probabilistically.

## Prerequisites

- Node.js 22.19 or newer
- npm
- A Querit API key
- A Browserbase account and API key

The current Browserbase Node SDK infers the project from the API key, so this demo does not require `BROWSERBASE_PROJECT_ID`.

## Quickstart

```bash
cd browserbase-querit-demo
npm ci
npm run build
```

Set credentials in the launching process environment.

**macOS/Linux**

```bash
export QUERIT_API_KEY="your-querit-key"
export BROWSERBASE_API_KEY="your-browserbase-key"
npm start -- "Browserbase Playwright documentation"
```

**PowerShell**

```powershell
$env:QUERIT_API_KEY = "your-querit-key"
$env:BROWSERBASE_API_KEY = "your-browserbase-key"
npm start -- "Browserbase Playwright documentation"
```

The search query must be 1–500 characters; anything longer fails with `INVALID_QUERY` before any network call.

`.env.example` documents the two variable names with blank values. The application does not load `.env` files automatically. Never pass keys in the query or commit a populated environment file.

## Output

Successful runs write the screenshot to `artifacts/evidence.png` and print JSON shaped like this:

```json
{
  "query": "Browserbase Playwright documentation",
  "citation": {
    "provider": "Querit",
    "searchId": "1234567890",
    "rank": 1,
    "title": "Example source",
    "url": "https://example.com/reference",
    "snippet": "Citation excerpt returned by Querit.",
    "passages": ["Supporting passage returned by Querit."],
    "siteName": "Example"
  },
  "browserEvidence": {
    "provider": "Browserbase",
    "sessionId": "session-id",
    "inspectorUrl": "https://www.browserbase.com/sessions/session-id",
    "finalUrl": "https://example.com/reference",
    "title": "Rendered page title",
    "screenshotPath": "artifacts/evidence.png"
  }
}
```

Open `inspectorUrl` to inspect the Browserbase session recording and logs. A rendered title, URL, and screenshot are browser evidence for the visit; they are not an independent endorsement of a page's claims.

## Why combine them?

Querit supplies live discovery results with source metadata and citation passages. Browserbase supplies a managed Chromium session that can render JavaScript and leave inspectable browser evidence. This demo shows a simple handoff between those roles.

Browserbase also offers its own [Search](https://docs.browserbase.com/platform/search/overview) and [Fetch](https://docs.browserbase.com/platform/fetch/overview) APIs. Those are native options for Browserbase-first discovery and lightweight retrieval. This example is an alternative provider workflow for teams that choose Querit for discovery/citation data and Browserbase for dynamic browser verification.

## Safety and credential handling

- Only `QUERIT_API_KEY` and `BROWSERBASE_API_KEY` are read, and only from `process.env`.
- Keys are never included in success output. Known key values are redacted from CLI errors.
- Querit response data is treated as untrusted. Malformed URLs, credential-bearing URLs, localhost names, and literal private/reserved IP targets are skipped.
- The Browserbase CDP connection URL is never printed.
- Browserbase recording and logging are enabled; page and browser handles are closed even when navigation fails.
- Review each destination's access rules and your organization's security requirements before adapting the demo.

## Development

The orchestration depends on small search, Browserbase-session, and browser ports. Unit tests inject fakes, so they require no credentials or network access.

```bash
npm run check       # strict TypeScript, including tests and live smoke
npm test            # offline unit tests
npm run build       # compile src/ to dist/
npm run pack        # dry-run package contents
npm run test:live   # real Querit + Browserbase smoke; requires both keys
```

Repository CI runs `npm ci`, check, tests, build, and pack without live credentials. The live smoke is deliberately opt-in.

## Project layout

```text
src/                 Core flow, CLI, and injectable live adapters
tests/               Offline unit tests
scripts/live-smoke.ts Opt-in end-to-end smoke test
docs/                Partner-facing introduction and quickstart drafts
artifacts/            Generated screenshots (gitignored)
```

See [`docs/introduction.md`](docs/introduction.md) for partner positioning and [`docs/quickstart.md`](docs/quickstart.md) for the integration guide.

## License

MIT — see [LICENSE](LICENSE).
