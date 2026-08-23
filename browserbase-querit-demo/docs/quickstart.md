# Quickstart

Run the deterministic Querit discovery → Browserbase verification workflow locally.

## Prerequisites

Before you start, make sure you have:

- Node.js 22.19 or newer and npm;
- a [Querit](https://www.querit.ai/) API key;
- an active [Browserbase](https://www.browserbase.com/) account and API key; and
- Browserbase browser-session capacity on the project associated with that key.

The current Browserbase Node SDK infers the project from `BROWSERBASE_API_KEY`. This demo intentionally requires no project ID and no additional credential.

## 1. Install

From the repository root:

```bash
cd browserbase-querit-demo
npm ci
npm run build
```

`npm ci` installs the official Browserbase TypeScript SDK (`@browserbasehq/sdk`) and Playwright Core (`playwright-core`) versions locked by this package.

## 2. Configure credentials

The application reads exactly two environment variables from the launching process.

### macOS or Linux

```bash
export QUERIT_API_KEY="your-querit-key"
export BROWSERBASE_API_KEY="your-browserbase-key"
```

### PowerShell

```powershell
$env:QUERIT_API_KEY = "your-querit-key"
$env:BROWSERBASE_API_KEY = "your-browserbase-key"
```

The checked-in `.env.example` contains blank placeholders only:

```dotenv
QUERIT_API_KEY=
BROWSERBASE_API_KEY=
```

It is documentation, not an automatically loaded configuration file. If your environment uses a secret manager or shell profile, export the values before starting the process. Do not add keys to command arguments, source files, or logs.

## 3. Run a query

```bash
npm start -- "Browserbase Playwright documentation"
```

Quote multi-word queries. The flow is fixed:

1. request five Querit candidates with citation content;
2. walk them in returned order and choose the first safe public HTTP(S) URL;
3. create a recorded, logged Browserbase session with `keepAlive: false`;
4. connect to the default Browserbase context with Playwright over CDP;
5. navigate until `domcontentloaded`;
6. capture the final URL, title, and `artifacts/evidence.png`; and
7. close the page and browser before returning.

The screenshot path is deterministic and is overwritten by the next run.

## 4. Read the result

The CLI writes one JSON object to standard output:

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

Querit fields explain why and where the source was discovered. Browserbase fields record what the remote browser reached and rendered. Redirects are visible when `citation.url` and `browserEvidence.finalUrl` differ.

## 5. Inspect the Browserbase session

Open the returned `browserEvidence.inspectorUrl` in an authenticated Browserbase account. Recording and session logging are enabled explicitly, so the session page can be used to review navigation and diagnose rendering behavior after the local CDP connection closes.

The CLI does not print the Browserbase CDP connection URL.

## Test without cloud credentials

All unit tests use injected adapters and run offline:

```bash
npm run check
npm test
npm run build
npm run pack
```

The tests cover:

- no Querit results;
- malformed and unsafe candidate URLs;
- Querit and Browserbase API error redaction;
- page/browser cleanup after navigation failures;
- session release when CDP connection fails; and
- final JSON citation/evidence output.

## Run the live smoke test

With both variables exported:

```bash
npm run test:live
```

This performs a real Querit search and consumes a real Browserbase session. It is intentionally excluded from package CI and cannot run without live credentials.

## Troubleshooting

### `INVALID_CONFIGURATION`

Confirm that both environment variables are present in the same shell that launches `npm start`. The code does not read `.env` automatically. Also confirm Node.js is at least 22.19.

### `QUERIT_API_ERROR`

Check the Querit key, account access, and network connectivity. The error includes a safe status/message when available, but redacts the known key value. Rate-limit or service errors can be retried by the calling application; this deterministic demo does not add automatic retries.

### `NO_RESULTS`

Querit returned an empty candidate list. Make the query more specific or try again later.

### `NO_SAFE_RESULT`

Results were present, but none had an eligible public HTTP(S) URL. The demo intentionally skips non-web schemes, credential-bearing URLs, localhost names, and literal private/reserved IP targets.

### `BROWSERBASE_API_ERROR`

Verify the Browserbase key and that its inferred project can create a session. Check account concurrency and plan limits in Browserbase. No `BROWSERBASE_PROJECT_ID` is read by this demo.

### `BROWSER_VERIFICATION_FAILED`

The CDP connection or navigation failed. Check destination availability, redirects, TLS behavior, and the Browserbase session page. Navigation uses a 45-second timeout and waits for `domcontentloaded` rather than all network activity.

### Screenshot is missing

A screenshot is written only after navigation, final-URL validation, and title capture succeed. Confirm the process can write to `artifacts/` and inspect the JSON error. Generated artifacts are gitignored.

### Session Inspector access

Use the Browserbase account that owns the API key. The inspector URL identifies the session but does not make a private session public.

## Native Browserbase alternatives

Browserbase's own [Search](https://docs.browserbase.com/platform/search/overview) and [Fetch](https://docs.browserbase.com/platform/fetch/overview) APIs can cover discovery and lightweight retrieval within Browserbase. This guide demonstrates Querit as an alternative discovery/citation provider feeding a Browserbase session; it does not replace or modify those native APIs.
