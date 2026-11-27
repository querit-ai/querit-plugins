# zapier-querit

A focused Zapier Platform CLI integration for live web search through [Querit](https://www.querit.ai). It exposes one Search action, **Find Web Search Results**. It intentionally includes no triggers, create actions, or page-content fetching.

## What it does

- Uses Zapier custom authentication with a masked password field for the Querit API key.
- Adds `Authorization: Bearer <key>` to every outbound request.
- Tests a connection with the smallest useful request available: a fixed `POST https://api.querit.ai/v1/search` request with `count: 1`. Querit does not expose an identity endpoint, so no connection label is synthesized.
- Sends Search input to `POST /v1/search` and returns `results.result` directly as Zapier search records—never as a line-item wrapper.
- Sends only the parameters a Zap sets, so Querit applies its own defaults. Result Count is never forced to 5.
- Retries the transient codes Querit documents (429, 500, 503) at most twice with jittered backoff and honors `Retry-After` up to 5 seconds. See [Retries and errors](#retries-and-errors).
- Keeps only valid HTTP(S) result URLs, normalizes them with the URL standard, and removes duplicate normalized URLs while preserving the first result.
- Gives each result a deterministic SHA-256 `id` derived from its normalized URL.
- Handles non-success HTTP responses and non-`200` Querit `error_code` values (checked even on an HTTP 200), rejects malformed success payloads, limits response size, and removes the API key and control sequences from user-visible errors.
- Ends every API failure message with the request's `search_id` when Querit returned one, so support can trace it.

Remote result text is third-party web data. A Zap should treat titles, snippets, and content excerpts as untrusted input.

## Requirements

- Node.js 22-compatible code (Zapier's current integration runtime)
- npm
- A Querit API key for account and live Zap testing
- A company-managed Zapier developer account for registration and deployment

The project uses plain CommonJS JavaScript and pins the current official Zapier release line: `zapier-platform-core` and `zapier-platform-cli` `19.1.0`. The lockfile overrides transitive `form-data` to patched version `4.0.6` for [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx).

## Search inputs

Any field left empty is not sent.

| Field | Required | Description |
| --- | --- | --- |
| `query` | Yes | Search text, 1–1,000 characters. |
| `count` | No | Maximum number of results, 1–100. When empty, Querit applies its own default count. |
| `time_range` | No | Preset period: `d7`, `w2`, `m3`, or `y1`. |
| `time_range_custom` | No | Any other period Querit accepts: `d30` (days), `w6` (weeks), `m2` (months), `y3` (years), or a date range such as `2026-01-01to2026-03-31` (a single day is allowed). Cannot be combined with `time_range`. |
| `countries` | No | Up to 20 supported country values. |
| `languages` | No | Up to 20 supported language values, including Russian. |
| `include_domains` | No | Domain allowlist, without URL schemes. |
| `exclude_domains` | No | Domain denylist, without URL schemes. |
| `vertical` | No | `code` or `finance`. Leave empty for universal search; a vertical that does not match the query loses results. |
| `resource_tags` | No | `qa` and/or `github`. Requires `vertical` to be `code`. |
| `rank_preference` | No | `relevance` or `freshness`. A boost on top of the default ranking, not a sort. Rejected with the `code` vertical because Querit returns 400 for that combination. |
| `include_content` | No | Requests the page body text with each result. |
| `content_max_chars` | No | Body characters per result, 1–1,000,000. Requires `include_content`; empty means the full body. |
| `highlights` | No | Requests query-focused fragments of the page body with each result. |
| `highlights_max_characters` | No | Highlight characters per result, 100–8,000. Requires `highlights`; empty lets Querit choose the length. |
| `chunks_per_doc` | No | Deprecated by Querit in favor of `highlights`. Content chunks per result, 1–3; sent only when a Zap sets it. |

The action maps these fields to Querit's documented request shape (`filters.sites`, `filters.timeRange`, `filters.geo`, `filters.languages`, `filters.vertical`, `filters.resourceTags`, `rank`, `needContent`, `contentMaxChars`, `highlights`, and `chunksPerDoc`). A filter that depends on another field is a handled input error rather than a bad request: `resource_tags` without the `code` vertical, `rank_preference` with the `code` vertical, `content_max_chars` without `include_content`, `highlights_max_characters` without `highlights`, or both time range fields at once.

## Search outputs

Every returned item is a flat object with these fields:

- `id`, `rank`
- `title`, `url`, `snippet`
- `page_age`, `site_name`, `site_icon`
- `content` (sentence excerpts joined as text)
- `highlights` (query-focused fragments joined as text)
- `query`, `search_id`, `took`
- `cost`

`page_age` is Querit's plaintext UTC time passed through unchanged. It is not ISO-8601, so reformat it before treating it as a date.

`cost` is Querit's reported charge for the request, shown with six decimals (for example `USD 0.000123`). It is empty when Querit did not report a cost, which means unavailable and never free. A reported zero charge is shown as `USD 0.000000`.

A response larger than 2 MB fails the search with a `QueritResponseError` naming the limit; it is never truncated or retried. Large result sets that also request body text can reach that limit, so lower `count` or set `content_max_chars` to keep them under it.

No matches returns `[]`.

## Retries and errors

Querit asks clients to check `error_code` in the response body even on an HTTP 200. The `error_code` is therefore taken as the verdict of every response: a non-200 `error_code` fails the search whatever the HTTP status was, and it is the code the retry decision and the reported error status use.

Only 429, 500, and 503 are retried: at most two retries (three requests in total). Each retry waits for a jittered exponential backoff, at most 500 ms before the first retry and at most 1,000 ms before the second. When the response carries `Retry-After` (delay-seconds or an HTTP-date), that delay is used instead of the backoff as long as it is at most 5 seconds; a longer one is not waited out, and the search fails at once with a message that says so.

Nothing else is retried: not 400, 401, 403, or 404, not network failures or timeouts, and not a malformed success payload.

Every API failure message ends with `[search_id: N]` when the response carried a `search_id`, and a failure that followed retries states how many attempts were made. When a 429 still fails after retries (or because `Retry-After` was too long), the action raises `ThrottledError`, the same error the Zapier platform raises for a 429 by default, with the `Retry-After` delay in seconds when one was sent.

## Local development

No Zapier or Querit secret is needed for the mocked local suite.

```bash
cd zapier-querit
npm ci
npm run check
npm run audit:production
npm run build
npm run pack:check
```

Scripts:

| Script | Purpose |
| --- | --- |
| `npm test` | Run Jest tests through Zapier's `createAppTester` with HTTP mocks. |
| `npm run validate` | Run local Zapier schema validation with `--without-style`; it makes no Zapier account request. |
| `npm run check` | Run tests and local schema validation. |
| `npm run audit:production` | Check production dependencies against npm's advisory service. |
| `npm run build` | Produce local Zapier build/source archives without remote validation. Local validation is a separate required step above. |
| `npm run pack:check` | Inspect the npm tarball without publishing it. |

`build/`, package tarballs, local environment files, and dependencies are ignored. Never put a Querit API key in source, tests, `.env`, logs, issue reports, or screenshots.

## Company-account handoff checklist

None of the following remote steps has been performed in this repository. They require the company-owned Zapier account and should be completed by its authorized operator.

### Registration and remote verification (blocked locally)

- [ ] Confirm the owning Zapier account belongs to Querit and add at least one integration admin with an email on the application/API's top-level company domain.
- [ ] Log in to Zapier Platform CLI with that company account.
- [ ] Register **Querit** as a new integration, or link this directory to the company-owned integration. Commit the generated `.zapierapprc`; do not put credentials in it.
- [ ] Run the full remote `zapier-platform validate` checks and resolve all errors, publishing warnings, and review suggestions.
- [ ] Push the version with `zapier-platform push` only after review of the generated definition and build archive.
- [ ] Add and verify branding in Platform UI: exact product name, convention-compliant description, marketing homepage, intended audience, company role, category, and a square transparent PNG logo at least 256×256 px.
- [ ] Connect a real Querit account in Zapier and confirm the fixed one-result authentication request succeeds without exposing the key.
- [ ] Test **Find Web Search Results** in the Zap editor with every optional field and representative empty/error cases.
- [ ] Create and turn on review Zaps that use the Search action, retain at least one successful Zap-history run for each test Zap, and do not delete that evidence.
- [ ] Check Platform UI monitoring for unexpected or unhandled errors.

### Zapier review prerequisites

- [ ] Confirm Querit and its production API are publicly launched, use HTTPS only, and have clear, current public API documentation covering `/v1/search` and every exposed filter.
- [ ] Confirm users can obtain their own API key without contacting support; Zapier states this is required for publishable API-key authentication.
- [ ] Confirm the integration owner has permission to use the API and Querit trademarks and can provide proof if requested.
- [ ] Confirm the integration requests credentials only in Authentication and never in Search fields.
- [ ] Review data handling, privacy, applicable website terms, and Zapier's policy for general-purpose data access. Keep user-facing copy about web search accurate and do not imply endorsement of third-party data extraction.
- [ ] Create the required non-expiring support test account for `integration-testing@zapier.com`, with sufficient API access/credits and no unnecessary administrative privileges; provide credentials only through Zapier's secure review process.
- [ ] Provide user help documentation and a support path covering API-key setup, fields, empty results, quotas, and common errors.
- [ ] Re-run local tests/build and remote validation on Node 22, then submit the completed publishing form in Platform UI.
- [ ] Address Zapier review feedback; after approval, monitor the Beta period and production health.

Official references:

- [Zapier Platform CLI overview](https://docs.zapier.com/integrations/build-cli/overview)
- [Integration publishing requirements](https://docs.zapier.com/integrations/publish/integration-publishing-requirements)
- [Public integration launch process](https://docs.zapier.com/integrations/publish/public-integration)
- [Branding requirements](https://docs.zapier.com/integrations/publish/add-or-modify-branding)

## License

MIT
