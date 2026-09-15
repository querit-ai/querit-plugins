# opencode-querit

[![license](https://img.shields.io/badge/license-MIT-yellow.svg)](./LICENSE)

[Querit](https://www.querit.ai) web search for [OpenCode](https://opencode.ai) v2 (requires opencode ≥ 2.0.3). The plugin registers **Querit as a websearch provider** — powering OpenCode's built-in `websearch` tool — plus a `web_fetch` custom tool for full page content via `POST https://api.querit.ai/v1/contents`. It is the OpenCode counterpart of [`pi-querit`](https://www.npmjs.com/package/pi-querit) and [`dsh-querit`](https://www.npmjs.com/package/dsh-querit).

OpenCode v2 ships a built-in `websearch` tool, but its hosted backends (Exa/Parallel) need `OPENCODE_ENABLE_EXA`/`OPENCODE_ENABLE_PARALLEL` or the OpenCode provider, and Tavily/Firecrawl need their own credentials. This plugin adds Querit to the provider list with no extra flags — use it with your own Querit API key.

Sign up on [Querit.ai](https://www.querit.ai) to get an API key with **1,000 free API calls per month** — no credit card required.

> Requires opencode v2 (`2.0.3+`). On opencode v1 pin [`opencode-querit@1.0.2`](https://www.npmjs.com/package/opencode-querit/v/1.0.2).

## Quick start

1. Add the plugin to `opencode.json`:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": ["opencode-querit"]
   }
   ```

2. Configure your Querit API key in priority order:
   - the `QUERIT_API_KEY` environment variable (default; override the name with `apiKeyEnv`) — the environment always wins, so one exported key overrides plugin options everywhere, or
   - `apiKey` in the plugin options (`{ "package": "opencode-querit", "options": { "apiKey": "..." } }`; least preferred — secrets should not live in config files).
3. Restart OpenCode and ask it to search the web. On the first `websearch` call OpenCode shows its provider form — pick **Querit** (the choice is remembered), or pin it once in config:

   ```json
   { "websearch": { "provider": "querit" } }
   ```

The `web_fetch` tool appears alongside the built-ins immediately.

### Test locally before publishing

Load the compiled plugin straight from this repository in any OpenCode project:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "file:///D:/work/queirt/querit-plugins/opencode-querit" }]
}
```

Point the path at your checkout and restart OpenCode. Without a configured key a `websearch`/`web_fetch` call fails with the actionable "Querit is not configured" message, which confirms the plugin loaded.

## Options

Options go under the plugin entry in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "opencode-querit", "options": {
      "count": 8,
      "timeRange": "m3",
      "languages": ["english"],
      "excludeDomains": ["pinterest.com", "facebook.com", "instagram.com", "tiktok.com"]
    } }
  ]
}
```

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal Querit API key. Prefer `apiKeyEnv` so no secret enters configuration. The `apiKeyEnv` environment variable always wins when both are set. |
| `apiKeyEnv` | `QUERIT_API_KEY` | Environment variable holding the Querit API key. A missing value fails the call with an actionable message. |
| `setDefault` | `false` | Make Querit the default websearch provider at startup. Off by default so the plugin never overrides the provider you picked in OpenCode's first-use form or via config `websearch.provider`. |
| `baseURL` | `https://api.querit.ai` | Querit API base; `/v1/search` and `/v1/contents` are appended. Falls back to `$QUERIT_BASE_URL`. |
| `timeoutMs` | `70000` | Per-request timeout in ms (minimum 1000). |
| `count` | `5` | Result count per search (1–20; the API caps at 20). |
| `timeRange` | none | Relative (`d7`, `w2`, `m3`, `y1`, or any `dN`/`wN`/`mN`/`yN`) or `YYYY-MM-DDtoYYYY-MM-DD` date range. |
| `countries` | none | Country bias. Valid values: `argentina`, `australia`, `brazil`, `canada`, `colombia`, `france`, `germany`, `india`, `indonesia`, `japan`, `mexico`, `nigeria`, `philippines`, `south korea`, `spain`, `united kingdom`, `united states`. |
| `languages` | none | Language filter. Valid values: `english`, `japanese`, `korean`, `german`, `french`, `spanish`, `portuguese`. |
| `includeDomains` | none | **Whitelist** hostnames; only these domains return results. |
| `excludeDomains` | none | **Blacklist** hostnames; these domains never return results. |
| `includeContent` | `false` | Request sentence-level content excerpts (`needContent`); excerpts are appended to each result's content. |
| `chunksPerDoc` | `1` | Content chunks per result (1–3). |
| `fetchFormat` | `markdown` | Default format requested from `/v1/contents` for fetch calls: `markdown`, `text`, or `html`. Per-call `format` overrides it. |
| `fetchCrawlTimeout` | `10` | Per-page crawl timeout in seconds (1–60). Per-call `crawl_timeout` overrides it. |
| `fetchMaxChars` | `8000` | Cap applied to one fetched page's decoded body, in chars; a cut page is flagged `truncated` in the tool metadata. |
| `maxOutputChars` | `200000` | Cap on one tool's rendered output / all search results' combined content, in chars. |

## What gets registered

### websearch provider (`querit`)

Powers OpenCode's built-in `websearch` tool. Each query is resolved with the current config and API key; search filters (domains, time range, region, language, content detail) come from the plugin options. Results map to OpenCode's provider shape — `url`, `title`, `content` (snippet plus requested sentence excerpts), `published` when the API reports a parsable page age — sanitized and length-capped before the model sees them. OpenCode renders the citations itself.

### web_fetch tool

```
url:              A single HTTP(S) URL to fetch.
urls:             HTTP(S) URLs to fetch. At most 10 URLs per call.
format:           Returned content format (default: markdown).
crawl_timeout:    Per-page crawl timeout in seconds (default: 10).
include_metadata: Include page metadata such as title and publication time (default: true).
```

Fetches full page content for up to 10 HTTP(S) URLs through Querit's crawler — useful where the built-in `webfetch` is blocked or rate-limited. URLs with embedded credentials are rejected, and every fetched page is capped at `fetchMaxChars` chars.

## Safety

Treat every search result and retrieved page as untrusted external data. Fetched pages are wrapped in explicit untrusted-content markers, terminal escape sequences and bidi controls are stripped from retrieved text, and the plugin never follows instructions found in retrieved content. Failures surface with the API key redacted; responses are size-limited (2 MiB search, 10 MiB contents).

## Development

```bash
npm install
npm run check   # typecheck src + tests
npm test        # vitest unit tests
npm run build   # tsc -> lib/
npm run test:live  # live smoke test against the real API (needs QUERIT_API_KEY)
```

## Packaging notes

`lib/` is committed: OpenCode loads npm plugins directly from the compiled package, and committing it lets users install from GitHub Release tarballs without a build toolchain. `@opencode/plugin` is an optional peer dependency used for types only — the compiled plugin is plain structural JavaScript that OpenCode v2 loads via `export default { id, setup }`; `zod` is the only runtime dependency.

## License

MIT
