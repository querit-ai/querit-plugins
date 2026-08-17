# opencode-querit

[![license](https://img.shields.io/badge/license-MIT-yellow.svg)](./LICENSE)

Querit-backed `web_search` and `web_fetch` custom tools for [OpenCode](https://opencode.ai). It is the OpenCode counterpart of [`pi-querit`](https://www.npmjs.com/package/pi-querit) and [`dsh-querit`](https://www.npmjs.com/package/dsh-querit): the plugin registers two model-facing tools that route through [Querit](https://www.querit.ai) — live web search and clean page content through `POST https://api.querit.ai/v1/search` and `/v1/contents`.

Sign up on [Querit.ai](https://www.querit.ai) to get an API key with **1,000 free API calls per month** — no credit card required.

## Quick start

1. Install the plugin from npm and add it to `opencode.json`:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["opencode-querit"]
   }
   ```

2. Configure your Querit API key in priority order:
   - the `QUERIT_API_KEY` environment variable (default; override the name with `apiKeyEnv`) — the environment always wins, so one exported key overrides plugin options everywhere, or
   - `apiKey` in the plugin options tuple (`["opencode-querit", { "apiKey": "..." }]`; least preferred — secrets should not live in config files).
3. Restart OpenCode. A tool call without a key fails with a message that spells out both options.

The two tools are `web_search` (live web search with cited results) and `web_fetch` (full page content for up to 10 URLs). They are additive: OpenCode's built-in `websearch`/`webfetch` tools stay available. To steer the model to Querit, mention the tools or restrict the built-ins through [permissions](https://opencode.ai/docs/permissions/).

### Test locally before publishing

Until the package is published (or to iterate on it), load the compiled plugin straight from this repository in any OpenCode project:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///D:/work/queirt/querit-plugins/opencode-querit/lib/index.js"]
}
```

Point the `file://` URL at your checkout and restart OpenCode; the tools appear alongside the built-ins. Verify quickly with a `web_search` call — without a configured key it fails with the actionable "Querit is not configured" message, which confirms the plugin loaded and the tools are wired.

## Options

Options go in the plugin tuple in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-querit", {
      "count": 8,
      "timeRange": "m3",
      "languages": ["english"],
      "excludeDomains": ["pinterest.com", "facebook.com", "instagram.com", "tiktok.com"]
    }]
  ]
}
```

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal Querit API key. Prefer `apiKeyEnv` so no secret enters configuration. The `apiKeyEnv` environment variable always wins when both are set. |
| `apiKeyEnv` | `QUERIT_API_KEY` | Environment variable holding the Querit API key. A missing value fails the tool call with an actionable message. |
| `baseURL` | `https://api.querit.ai` | Querit API base; `/v1/search` and `/v1/contents` are appended. Falls back to `$QUERIT_BASE_URL`. |
| `timeoutMs` | `70000` | Per-request timeout in ms (minimum 1000). |
| `count` | `5` | Default result count per search (1–20; the API caps at 20). Per-call `count` overrides it. |
| `timeRange` | none | Relative (`d7`, `w2`, `m3`, `y1`, or any `dN`/`wN`/`mN`/`yN`) or `YYYY-MM-DDtoYYYY-MM-DD` date range. |
| `countries` | none | Country bias. Valid values: `argentina`, `australia`, `brazil`, `canada`, `colombia`, `france`, `germany`, `india`, `indonesia`, `japan`, `mexico`, `nigeria`, `philippines`, `south korea`, `spain`, `united kingdom`, `united states`. |
| `languages` | none | Language filter. Valid values: `english`, `japanese`, `korean`, `german`, `french`, `spanish`, `portuguese`. |
| `includeDomains` | none | **Whitelist** hostnames; only these domains return results. |
| `excludeDomains` | none | **Blacklist** hostnames; these domains never return results. |
| `includeContent` | `false` | Request sentence-level content excerpts (`needContent`); excerpts are appended to each source's snippet. |
| `chunksPerDoc` | `1` | Content chunks per result (1–3). |
| `fetchFormat` | `markdown` | Default format requested from `/v1/contents` for fetch calls: `markdown`, `text`, or `html`. Per-call `format` overrides it. |
| `fetchCrawlTimeout` | `10` | Per-page crawl timeout in seconds (1–60). Per-call `crawl_timeout` overrides it. |
| `fetchMaxChars` | `8000` | Cap applied to one fetched page's decoded body, in chars; a cut page is flagged `truncated` in the tool metadata. |
| `maxOutputChars` | `200000` | Cap on one tool's rendered output, in chars. |

## Tools

### web_search

```
query:  The web search query.
count:  Maximum results to return (default: 5).
```

Search filters (domains, time range, region, language, content detail) are persistent defaults from the plugin options; per-call parameters are limited to `query` and `count`. Returns raw cited results. The tool description instructs the model to treat everything returned as untrusted web data and to cite the returned URLs.

### web_fetch

```
url:             A single HTTP(S) URL to fetch.
urls:            HTTP(S) URLs to fetch. At most 10 URLs per call.
format:          Returned content format (default: markdown).
crawl_timeout:   Per-page crawl timeout in seconds (default: 10).
include_metadata: Include page metadata such as title and publication time (default: true).
```

Fetches full page content for up to 10 HTTP(S) URLs. URLs with embedded credentials are rejected, and every fetched page is capped at `fetchMaxChars` chars.

## Mapping

Search results become citeable sources: `url` ← `url`, `title` ← `title`, `snippet` ← `snippet` plus requested sentence excerpts, `publishedAt` ← `page_age`. Results are deduplicated by URL and normalized to HTTP(S). Fetch maps each crawled page to its content (`text`/`markdown`/`html` per `format`); pages without returned content are listed at the end of the output instead of failing the whole call.

Failures surface as tool errors with the API key redacted; responses are size-limited (2 MiB search, 10 MiB contents) and retrieved text is stripped of terminal escape/control sequences and bidi controls before the model sees it.

## Safety

Treat every search result and retrieved page as untrusted external data. The tools tell the model this on every call (the rendered output always opens with an untrusted-data warning), and the plugin never follows instructions found in retrieved content.

## Development

```bash
npm install
npm run check   # typecheck src + tests
npm test        # vitest unit tests
npm run build   # tsc -> lib/
npm run test:live  # live smoke test against the real API (needs QUERIT_API_KEY)
```

## Packaging notes

`lib/` is committed: OpenCode loads npm plugins directly from the compiled package, and committing it lets users install from GitHub Release tarballs without a build toolchain. `@opencode-ai/plugin` is an (optional) peer dependency — OpenCode resolves it at plugin load time; install it as a dev dependency for local builds.

## License

MIT
