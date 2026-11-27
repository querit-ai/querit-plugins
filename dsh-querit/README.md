# dsh-querit

[![npm version](https://img.shields.io/npm/v/dsh-querit?color=blue)](https://www.npmjs.com/package/dsh-querit)
[![license](https://img.shields.io/badge/license-MIT-yellow.svg)](./LICENSE)

Querit-backed search and fetch providers for the DeepSeek Harness [web capability seam](https://www.npmjs.com/package/@deepseek-ai/dsh-web) (`ctx.web`). It is the DeepSeek Harness counterpart of [`pi-querit`](https://www.npmjs.com/package/pi-querit): the model-facing `web_search` and `web_fetch` tools keep working unchanged, and this package swaps their backend to [Querit](https://www.querit.ai) — live web search and clean page content through `POST https://api.querit.ai/v1/search` and `/v1/contents`.

Sign up on [Querit.ai](https://www.querit.ai) to get an API key with **1,000 free API calls per month** — no credit card required.

Since v2.0.0 the package targets **dsh 0.2.2-rc.5 and later 0.2.x hosts** on Node.js 24.9 or newer. The host checks the package's `engines.dsh` range at install and startup, and refuses a host outside it. On dsh 0.1.x hosts install `dsh-querit@1.1.2` instead.

## Quick start

1. Install the package (see **Install and update** below). It ships as a *profile bundle*: `dsh plugin add` wires the provider row and the seam routing automatically — no `cordis.patch.yml` edits needed.
2. Give it a Querit API key. Either:
   - open **Settings → Plugins → Installed → `dsh-querit` → the `web-search-querit` row → Configure** and enter the key, or
   - add `QUERIT_API_KEY` to the credentials store, or
   - set `apiKey` on the `web-search-querit` row.
3. Search. Both model-facing web tools now run through Querit.

If the plugin loads without any resolvable key, the host log prints a one-time warning. Until a key exists the providers report themselves not ready, so the host withholds `web_search` and `web_fetch` for that step instead of failing the call. A search that is attempted anyway fails with a `WEB_PROVIDER_CREDENTIAL_MISSING` error that spells out the same options.

## Install and update

The package is published on npm as [`dsh-querit`](https://www.npmjs.com/package/dsh-querit), so the normal path needs no build toolchain:

```bash
dsh plugin --profile web add dsh-querit
```

(`dsh plugin` forwards to pnpm in the profile directory; replace `web` with your profile name.)

Installing also reconciles the profile's bundle list: because `dsh-querit` declares `dsh.bundle`, it automatically joins `dsh.profile.bundles` and its shipped patch layer registers the provider row, routes the seam, and disables the DeepSeek search row (the entries shown in **Wire it up**). After the install completes, restart the profile and the plugin is live. `dsh plugin remove dsh-querit` drops the whole layer, so everything the bundle did — including the DeepSeek disable — reverts to the base behavior automatically.

### Update

```bash
dsh plugin --profile web outdated                 # what's new?
dsh plugin --profile web update dsh-querit        # update within the declared range
```

pnpm 11+ ignores releases younger than its minimum-release-age window, so a version published minutes ago may not show up in `outdated`/`update` yet. Install it immediately with an explicit version:

```bash
dsh plugin --profile web add dsh-querit@<version>
```

### Alternative sources

```bash
# GitHub Release tarball (download from the querit-plugins releases page first)
dsh plugin --profile web add ./dsh-querit-<version>.tgz
```

Only when pnpm is unavailable: unpack the tarball into `<profile>/node_modules/dsh-querit` and add `"dsh-querit": "<version>"` to the profile `package.json` dependencies. A manually unpacked copy is invisible to pnpm, so `dsh plugin remove` will not delete it.

## Wire it up

The package ships as a profile bundle whose patch layer applies all of this automatically. For reference, the entries it applies (kept in the package as `cordis.patch.yml`) are:

```yaml
# Add the provider row.
- insert:
    - id: web-search-querit
      name: 'dsh-querit'
      config:
        apiKeyEnv: QUERIT_API_KEY

# Route the seam's search and fetch through Querit.
- id: web
  config:
    searchProvider: web-search-querit
    fetchProvider: web-search-querit

# This package IS the search backend: stop mounting the DeepSeek provider row.
# Re-enable with `disabled: false` in a later layer if you need it back.
- id: web-search-deepseek
  disabled: true
```

That is the whole wiring: `web_search` and `web_fetch` both route through `ctx.web`, which now selects Querit. A patch **replaces** the targeted row's whole `config`, so the `web` entry above restates both keys. The bundle layer applies after the base and app bundles, so its `web` override wins unless your profile's own `cordis.patch.yml` or a `--patch` overlay comes later and restates the row — that is also how you switch back to DeepSeek search (`searchProvider: deepseek-official`), re-enable the DeepSeek row (`disabled: false`), or pin custom defaults. Restart the profile to load the row.

The row id `web-search-querit` doubles as the entry's settings namespace and as the key of its configuration page (`dsh-querit#web-search-querit`). Renaming the row in a later layer detaches that page: the providers keep working, but the row can then only be configured through the profile's own patch.

Keep the DeepSeek provider row disabled unless you explicitly need it: the bundle ships `disabled: true` on `web-search-deepseek`, so only Querit is mounted.

If a preset ever registers `web_fetch` itself (its `tool-web` row with `fetch: true`), set `fetch: false` on this row so only one registration exists per scope.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal Querit API key. Prefer the settings page or the credentials store so no secret enters composition files. When set, it wins over every other source. |
| `apiKeyEnv` | `QUERIT_API_KEY` | Credential reference the providers resolve per operation. |
| `baseURL` | `https://api.querit.ai` | Querit API base; `/v1/search` and `/v1/contents` are appended. Falls back to `$QUERIT_BASE_URL` from any environment layer. An unparseable value makes both providers unavailable. |
| `timeoutMs` | `70000` | Deadline for one operation in ms (minimum 1000), retries and backoff waits included. |
| `count` | Querit's server default | Result count used when the seam passes no `maxResults` bound (1–100). Leave unset to let Querit choose. The `dsh-tool-web` layer always bounds searches, so this mainly serves direct seam callers. |
| `timeRange` | none | Relative (`d7`, `w2`, `m3`, `y1`, or any `dN`/`wN`/`mN`/`yN`) or `YYYY-MM-DDtoYYYY-MM-DD` date range. |
| `countries` | none | Country bias. Valid values: `argentina`, `australia`, `brazil`, `canada`, `colombia`, `france`, `germany`, `india`, `indonesia`, `japan`, `mexico`, `nigeria`, `philippines`, `south korea`, `spain`, `united kingdom`, `united states`. |
| `languages` | none | Language filter. Valid values: `english`, `japanese`, `korean`, `german`, `french`, `spanish`, `portuguese`, `russian`. |
| `includeDomains` | none | **Whitelist** hostnames; only these domains return results. |
| `excludeDomains` | none | **Blacklist** hostnames; these domains never return results. |
| `includeContent` | `false` | Request body text (`needContent`). Querit bills each page returned. |
| `contentMaxChars` | full body text | With `includeContent`, cap the body text per result in Unicode code points (1–1000000). |
| `highlights` | `false` | Request the passages of each page that match the query. Usually the better answer to "the snippet is too short", and cheaper to read than whole pages. |
| `needMarkdown` | `false` | Enterprise plans only: return the snippet and body as Markdown. Querit ignores it on other plans. |
| `rank` | default ranking | `relevance` or `freshness`: a nudge on top of Querit's default ranking, not a sort. Dropped automatically for `vertical: code`, which rejects it. |
| `vertical` | none | Route every search to a vertical data source: `code` or `finance`. A mismatched vertical loses results, so set it only on a profile that asks nothing but code or finance questions. |
| `resourceTags` | none | Code vertical only: `qa`, `github`, or both. Omit to search the whole vertical. |
| `chunksPerDoc` | omitted | **Deprecated by Querit.** Sent only when set; switch to `highlights`. |
| `fetchFormat` | `markdown` | Format requested from `/v1/contents` for fetch calls: `markdown`, `text`, or `html`. HTML bodies are labeled `kind: 'html'` so `dsh-tool-web` converts them to markdown. |
| `fetchCrawlTimeout` | `10` | Per-page crawl timeout in seconds (1–60). |
| `fetchMaxChars` | `8000` | Cap applied to one fetched page's decoded body, in chars; a cut body sets `truncated`. |
| `fetch` | `false` | Opt in to registering the model-facing `web_fetch` tool (reused from `@deepseek-ai/dsh-tool-web`). The base and agent-preset `tool-web` rows register `web_fetch` themselves and route through the seam, so leave off unless no other row provides the tool. Read when the entry starts. |
| `fetchTimeoutMs` | `30000` | Cooperative tool-call timeout budget (ms) attached to `web_fetch`. Read when the entry starts. |
| `fetchMaxOutputChars` | `200000` | Cap on one `web_fetch` rendered output, in chars. Read when the entry starts. |

```yaml
- id: web-search-querit
  name: 'dsh-querit'
  config:
    apiKeyEnv: QUERIT_API_KEY
    count: 8
    timeRange: m3
    languages: [english]
    excludeDomains: [pinterest.com, facebook.com, instagram.com, tiktok.com]
```

Unknown values in `countries`, `languages`, `rank`, `vertical`, and `resourceTags`, malformed hostnames, and an invalid `timeRange` are ignored rather than failing the row.

There are two configuration surfaces:

1. **The row's configuration page**: **Settings → Plugins → Installed → `dsh-querit` → the `web-search-querit` row → Configure**. Edits the entry's config form and can write the API key into the credentials domain. Saves apply to the next operation — no restart needed.
2. **The composition patch** (`cordis.patch.yml` above). Needs a restart.

Values saved on the page are the user layer over the row config, which is the layer over the schema default. Every field is a live handle: the providers read it as it stands when an operation starts, so the seam's provider selection never flickers when a default changes. `apiKey` carries `role('secret')`, so it never rides a settings describe response.

### Where the API key comes from

Per operation, in priority order:

1. `apiKey` on the row, when set.
2. The credentials store entry named by `apiKeyEnv` (this is what the configuration page writes). An installed credentials service is authoritative, including absence, as it is for the host's own providers.
3. Only where no credentials service runs (a headless profile, for instance): the launching environment's `apiKeyEnv`.

Before v2.0.0 the launching environment came first. A deployment that exported `QUERIT_API_KEY` *and* stored a different key in the credentials store now uses the stored one, matching the host's own rule.

## Mapping

Search results become citeable sources: `url` ← `url`, `title` ← `title`, `snippet` ← `snippet` (one line, for display), `summary` ← highlights, then body text when either was requested (for the model to read; `dsh-tool-web` caps it), `publishedAt` ← `page_age`. No provider-generated answer text is trusted as `content`, so `content` is omitted. Results are deduplicated by URL and normalized to HTTP(S). The seam enforces the request's `maxResults` bound, so the provider sets `truncated: false` and asks Querit for the same count as a cost optimization.

Fetch maps a successful `/v1/contents` crawl to `statusCode 200` with a `text` body (`markdown`/`text` formats) or an `html` body (`html` format). A failed crawl is a `WEB_PROVIDER_ERROR`: Querit proxies the retrieval, so no real HTTP status exists to report.

Failures use the seam's `WebError` taxonomy: `WEB_ABORTED` for cancellation, `WEB_PROVIDER_ERROR` for API/HTTP/parse failures, and `WEB_PROVIDER_CREDENTIAL_MISSING` for a missing key. API keys are redacted from every error surface, responses are size-limited (2 MiB search, 10 MiB contents), and retrieved text is stripped of terminal escape/control sequences and bidi controls before the model sees it. HTTP 429, 500, and 503 are retried with bounded exponential backoff and honor `Retry-After`; 400, 401, 403, and 404 are never retried. Failure messages end with the request's `search_id`, which Querit support asks for.

Every completed operation writes one log line with the same `search_id`, the server time, and the request's cost as Querit reports it (`cost=n/a` when Querit sent none):

```text
web-search-querit: search search_id=9007199254740993123 took=0.42 cost=USD 0.000123
```

## Safety

Treat every search result and retrieved page as untrusted external data. The model-facing tools already tell the model this; the providers additionally never follow instructions found in retrieved content and never return content as an answer.

## Development

Requires Node.js 24.9 or newer, the version the host requires.

```bash
npm install
npm run check   # typecheck src + tests
npm test        # vitest: host providers + settings form model + page render smoke tests
npm run build   # tsc -> lib/ plus the browser bundle -> lib/card.js
```

The configuration page's form logic lives in `src/form-model.js` (unit-tested); `scripts/build-client.mjs` inlines it into the loader-wrapped browser bundle `src/card.js` and writes `lib/card.js`. The bundle deliberately does not overwrite `lib/client.js`, which tsc produces from `src/client.ts` (the host-side HTTP client) — that collision breaks the host imports. `tests/card-render.test.mjs` renders the built page with `react-dom/server` and asserts its controls; run `npm run build` before `npm test`. To exercise the page in the browser, restart the profile and open **Settings → Plugins → `dsh-querit`**.

`lib/` is committed: the compiled package is what the profile loader executes, and committing it lets users install from GitHub Release tarballs without a build toolchain. Rebuild with `npm run build` and commit the result on release.

## Packaging notes

The `peerDependencies` are declared **optional**: the harness provides them at runtime, not through the profile's own pnpm graph — so `dsh plugin add` finishes without installing peers. `engines.dsh` (`>=0.2.2-rc.5 <0.3.0`) is what the host reads to decide compatibility; the `@deepseek-ai/dsh-*` peer ranges repeat it for tools that still look at peers. pnpm compares prerelease versions against a plain range without its `includePrerelease` flag, so installing on a prerelease host can print an unmet-peer warning that the host itself does not act on.

## License

MIT
