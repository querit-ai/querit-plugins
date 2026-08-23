# zapier-querit

A focused Zapier Platform CLI integration for live web search through [Querit](https://www.querit.ai). It exposes one Search action, **Find Web Search Results**. It intentionally includes no triggers, create actions, or page-content fetching.

## What it does

- Uses Zapier custom authentication with a masked password field for the Querit API key.
- Adds `Authorization: Bearer <key>` to every outbound request.
- Tests a connection with the smallest useful request available: a fixed `POST https://api.querit.ai/v1/search` request with `count: 1`. Querit does not expose an identity endpoint, so no connection label is synthesized.
- Sends Search input to `POST /v1/search` and returns `results.result` directly as Zapier search records—never as a line-item wrapper.
- Keeps only valid HTTP(S) result URLs, normalizes them with the URL standard, and removes duplicate normalized URLs while preserving the first result.
- Gives each result a deterministic SHA-256 `id` derived from its normalized URL.
- Handles non-success HTTP responses and non-`200` Querit `error_code` values, rejects malformed success payloads, limits response size, and removes the API key and control sequences from user-visible errors.

Remote result text is third-party web data. A Zap should treat titles, snippets, and content excerpts as untrusted input.

## Requirements

- Node.js 22-compatible code (Zapier's current integration runtime)
- npm
- A Querit API key for account and live Zap testing
- A company-managed Zapier developer account for registration and deployment

The project uses plain CommonJS JavaScript and pins the current official Zapier release line: `zapier-platform-core` and `zapier-platform-cli` `19.1.0`. The lockfile overrides transitive `form-data` to patched version `4.0.6` for [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx).

## Search inputs

| Field | Required | Description |
| --- | --- | --- |
| `query` | Yes | Search text, 1–1,000 characters. |
| `count` | No | Result count, 1–20; defaults to 5. |
| `time_range` | No | `d7`, `w2`, `m3`, or `y1`. |
| `countries` | No | Up to 20 supported country values. |
| `languages` | No | Up to 20 supported language values. |
| `include_domains` | No | Domain allowlist, without URL schemes. |
| `exclude_domains` | No | Domain denylist, without URL schemes. |
| `include_content` | No | Requests sentence-level content excerpts. |
| `chunks_per_doc` | No | Content chunks per result, 1–3. |

The action maps these fields to Querit's documented request shape (`filters.sites`, `filters.timeRange`, `filters.geo`, `filters.languages`, `needContent`, and `chunksPerDoc`).

## Search outputs

Every returned item is a flat object with these fields:

- `id`, `rank`
- `title`, `url`, `snippet`
- `page_age`, `site_name`, `site_icon`
- `content` (sentence excerpts joined as text)
- `query`, `search_id`, `took`

No matches returns `[]`.

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
