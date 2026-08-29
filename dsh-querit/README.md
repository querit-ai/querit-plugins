# dsh-querit

[![license](https://img.shields.io/badge/license-MIT-yellow.svg)](./LICENSE)

Querit-backed search and fetch providers for the DeepSeek Harness [web capability seam](https://www.npmjs.com/package/@deepseek-ai/dsh-web) (`ctx.web`). It is the DeepSeek Harness counterpart of [`pi-querit`](https://www.npmjs.com/package/pi-querit): the model-facing `web_search` and `web_fetch` tools keep working unchanged, and this package swaps their backend to [Querit](https://www.querit.ai) — live web search and clean page content through `POST https://api.querit.ai/v1/search` and `/v1/contents`.

Sign up on [Querit.ai](https://www.querit.ai) to get an API key with **1,000 free API calls per month** — no credit card required.

## Quick start

1. Install the package (see **Install and update** below). Since v1.0.3 the package ships as a *profile bundle*: `dsh plugin add` wires the provider row and the seam routing automatically — no `cordis.patch.yml` edits needed (see **Wire it up** for what it applies and how to override). Since v1.0.4 the bundle also disables the shipped DeepSeek search provider row, and removing the package restores it.
2. Configure your Querit API key in priority order:
   - `QUERIT_API_KEY` in the launching environment, or
   - the credentials store (`$DSH_HOME/.credentials.yaml`: `QUERIT_API_KEY: <key>`, hot-reloaded — no restart needed), or
   - the settings page card (v1.0.4+, **Settings → Plugins → Plugin configuration → Querit web search**), or
   - `apiKey` on the `web-search-querit` row (a literal; least preferred, secrets should not live in composition files).
3. Restart the profile to load the plugin row and its settings card.

If the plugin loads without any resolvable key, the host log prints a one-time warning; a search attempted before a key is configured fails with a `WEB_PROVIDER_CREDENTIAL_MISSING` error that spells out the same three options.

Since v1.0.4 the package also ships a browser half with a settings card: **Settings → Plugins → Plugin configuration** lists a "Querit web search" card that edits the `web-search-querit` namespace (credential reference, result count, time range, languages, countries, domain lists, content excerpts, fetch format) and can write the API key straight into the credentials domain. Its writes go through the same settings transport as `$DSH_HOME/settings.yaml` (see **Config**). Since v1.0.6 the card chrome (background, padding, font size, chevron toggle, button styles) matches the official plugin cards shipped by `@deepseek-ai/dsh-client-ui-settings-plugins`, so the entry sits flush with "Terminal", "Agent loop", and the DeepSeek "Web search" row.

This is an **implementation** package: it registers one search provider and one fetch provider into `ctx.web`. Per operation, it resolves the API key from the launching environment first, then the optional `ctx.credentials` seam, then literal config. It does not register the model-facing `web_search` tool (the agent preset does); by default, it reuses [`@deepseek-ai/dsh-tool-web`](https://www.npmjs.com/package/@deepseek-ai/dsh-tool-web)'s `applyWebFetchTool` to register `web_fetch`. That last step exists because in the web app the host `tool-web` row is disabled and the shipped presets keep `fetch: false` — this package is the one place that turns page retrieval on. Both providers share the stable id `querit`.

## Install and update

The package is published on npm as [`dsh-querit`](https://www.npmjs.com/package/dsh-querit), so the normal path needs no build toolchain:

```bash
dsh plugin --profile web add dsh-querit
```

(`dsh plugin` forwards to pnpm in the profile directory; replace `web` with your profile name.)

Installing also reconciles the profile's bundle list: because `dsh-querit` declares `dsh.bundle`, it automatically joins `dsh.profile.bundles` and its shipped patch layer registers the provider row, routes the seam, and disables the DeepSeek search row (the entries shown in **Wire it up**). After the install completes, restart the profile and the plugin is live. `dsh plugin remove dsh-querit` drops the whole layer, so everything the bundle did — including the DeepSeek disable — reverts to the base behavior automatically. The manual wiring below is only needed for pre-1.0.3 installs or when you override the bundle's default row values.

### Update

```bash
dsh plugin --profile web outdated                 # what's new?
dsh plugin --profile web update dsh-querit    # update within the declared range
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

Since v1.0.3 the package ships as a profile bundle whose patch layer applies all of this automatically. For reference, the entries it applies (kept in the package as `cordis.patch.yml`) are:

```yaml
# Add the provider row (registers the Querit providers AND the web_fetch tool).
- insert:
    - id: web-search-querit
      name: 'dsh-querit'
      config:
        apiKeyEnv: QUERIT_API_KEY

# Route the seam's search and fetch through Querit.
- id: web
  config:
    searchProvider: querit
    fetchProvider: querit

# This package IS the search backend: stop mounting the DeepSeek provider row.
# Re-enable with `disabled: false` in a later layer if you need it back.
- id: web-search-deepseek
  disabled: true
```

That is the whole wiring: `web_search` (registered per session by the agent preset) and `web_fetch` (registered by this package) both route through `ctx.web`, which now selects Querit. A patch **replaces** the targeted row's whole `config`, so the `web` entry above restates both keys. The bundle layer applies after the base and app bundles, so its `web` override wins unless your profile's own `cordis.patch.yml` or a `--patch` overlay comes later and restates the row — that is also how you switch back to DeepSeek search (`searchProvider: deepseek-official`), re-enable the DeepSeek row (`disabled: false`), or pin custom defaults. Store the API key through the credentials service, export `QUERIT_API_KEY` in the launching environment, or set a literal `apiKey` in the row above. Restart the profile to load the row.

Keep the DeepSeek provider row disabled unless you explicitly need it: since v1.0.4 the bundle ships `disabled: true` on `web-search-deepseek`, so only Querit is mounted. Adding `- id: web-search-deepseek / disabled: false` to a later layer re-enables it while the seam keeps selecting Querit.

If a preset ever registers `web_fetch` itself (its `tool-web` row with `fetch: true`), set `fetch: false` on this row so only one registration exists per scope.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal Querit API key. Prefer `apiKeyEnv` so no secret enters configuration. The `apiKeyEnv` environment variable wins when both are set. |
| `apiKeyEnv` | `QUERIT_API_KEY` | Credential reference resolved per operation from the launching environment first, then through `ctx.credentials`; a literal `apiKey` is the final fallback. A missing value fails the call as `WEB_PROVIDER_CREDENTIAL_MISSING`. |
| `baseURL` | `https://api.querit.ai` | Querit API base; `/v1/search` and `/v1/contents` are appended. Falls back to `$QUERIT_BASE_URL` from any environment layer. An unparseable value makes both providers unavailable. |
| `timeoutMs` | `70000` | Per-request timeout in ms (minimum 1000). |
| `count` | `5` | Result count used when the seam passes no `maxResults` bound (1–20; the API caps at 20). The `dsh-tool-web` layer always bounds searches, so this mainly serves direct seam callers. |
| `timeRange` | none | Relative (`d7`, `w2`, `m3`, `y1`, or any `dN`/`wN`/`mN`/`yN`) or `YYYY-MM-DDtoYYYY-MM-DD` date range. |
| `countries` | none | Country bias. Valid values: `argentina`, `australia`, `brazil`, `canada`, `colombia`, `france`, `germany`, `india`, `indonesia`, `japan`, `mexico`, `nigeria`, `philippines`, `south korea`, `spain`, `united kingdom`, `united states`. |
| `languages` | none | Language filter. Valid values: `english`, `japanese`, `korean`, `german`, `french`, `spanish`, `portuguese`. |
| `includeDomains` | none | **Whitelist** hostnames; only these domains return results. |
| `excludeDomains` | none | **Blacklist** hostnames; these domains never return results. |
| `includeContent` | `false` | Request sentence-level content excerpts (`needContent`); excerpts are appended to each source's snippet. |
| `chunksPerDoc` | `1` | Content chunks per result (1–3). |
| `fetchFormat` | `markdown` | Format requested from `/v1/contents` for fetch calls: `markdown`, `text`, or `html`. HTML bodies are labeled `kind: 'html'` so `dsh-tool-web` converts them to markdown. |
| `fetchCrawlTimeout` | `10` | Per-page crawl timeout in seconds (1–60). |
| `fetchMaxChars` | `8000` | Cap applied to one fetched page's decoded body, in chars; a cut body sets `truncated`. |
| `fetch` | `true` | Register the model-facing `web_fetch` tool (reused from `@deepseek-ai/dsh-tool-web`). Set `false` when another row already registers `web_fetch`. |
| `fetchTimeoutMs` | `30000` | Cooperative tool-call timeout budget (ms) attached to `web_fetch`. |
| `fetchMaxOutputChars` | `200000` | Cap on one `web_fetch` rendered output, in chars. |

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

The entry above is the base layer of the `web-search-querit` Settings section: a user layer over it reaches the NEXT operation, because the providers project the section per call rather than capturing it at registration. The seam's provider selection therefore never flickers when a default changes. `apiKey` carries `role('secret')`, so it never rides a `describe()` response — a configuration surface learns only whether the credentials domain holds a value for the reference `apiKeyEnv` names.

There are three configuration surfaces (the settings-page card writes through two of them):

1. **The settings page card** (v1.0.4+): **Settings → Plugins → Plugin configuration → Querit web search**. Edits the `web-search-querit` namespace and can write the API key into the credentials domain. No restart needed for saves.
2. **The composition patch** (`cordis.patch.yml` above) — needs a restart.
3. **The settings document** — `$DSH_HOME/settings.yaml`, the same directory as `.credentials.yaml`. A `web-search-querit:` section there overrides the row config and **hot-reloads** (the settings provider watches the file; verified live — no restart needed). The settings card writes this same document through the settings service:

```yaml
web-search-querit:
  count: 3
  timeRange: m3
  languages: [english]
```

Resolution order per field: `settings.yaml` section (including card writes) > `cordis.patch.yml` row config > schema default. The API key is kept separately in `.credentials.yaml` (or the launching environment, or the card's write-only key input), never in `settings.yaml`.

## Mapping

Search results become citeable sources: `url` ← `url`, `title` ← `title`, `snippet` ← `snippet` plus requested sentence excerpts, `publishedAt` ← `page_age`. No provider-generated answer text is trusted as `content`, so `content` is omitted. Results are deduplicated by URL and normalized to HTTP(S). The seam enforces the request's `maxResults` bound, so the provider sets `truncated: false` and applies `min(maxResults, 20)` at the request layer as a cost optimization.

Fetch maps a successful `/v1/contents` crawl to `statusCode 200` with a `text` body (`markdown`/`text` formats) or an `html` body (`html` format). A failed crawl is a `WEB_PROVIDER_ERROR`: Querit proxies the retrieval, so no real HTTP status exists to report.

Failures use the seam's `WebError` taxonomy: `WEB_ABORTED` for cancellation, `WEB_PROVIDER_ERROR` for API/HTTP/parse failures, and `WEB_PROVIDER_CREDENTIAL_MISSING` for a missing key. API keys are redacted from every error surface, responses are size-limited (2 MiB search, 10 MiB contents), and retrieved text is stripped of terminal escape/control sequences and bidi controls before the model sees it.

## Safety

Treat every search result and retrieved page as untrusted external data. The model-facing tools already tell the model this; the providers additionally never follow instructions found in retrieved content and never return content as an answer.

## Development

```bash
npm install
npm run check   # typecheck src + tests
npm test        # vitest: host providers + settings form model + card render smoke tests
npm run build   # tsc -> lib/ plus the browser bundle -> lib/card.js
```

The settings card's form logic lives in `src/form-model.js` (unit-tested); `scripts/build-client.mjs` inlines it into the loader-wrapped browser bundle `src/card.js` and writes `lib/card.js`. The bundle deliberately does not overwrite `lib/client.js`, which tsc produces from `src/client.ts` (the host-side HTTP client) — that collision breaks the host imports. `tests/card-render.test.mjs` renders the built card with `react-dom/server` and asserts its controls; run `npm run build` before `npm test`. To exercise the card in the browser, restart the profile and open **Settings → Plugins → Plugin configuration**.

## Packaging notes

The `peerDependencies` are declared **optional**: the harness provides them at runtime (the profile boot resolves them through the flat module fallback under `$DSH_HOME/profiles/node_modules`), not through the profile's own pnpm graph — so `dsh plugin add` finishes without installing peers and prints no peer warnings.

## License

MIT
