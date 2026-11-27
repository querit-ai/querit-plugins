# opencode-querit

[![license](https://img.shields.io/badge/license-MIT-yellow.svg)](./LICENSE)

[Querit](https://www.querit.ai) web search for [OpenCode](https://opencode.ai) v2 (requires OpenCode **2.0.28 or later** on the 2.x line; verified against 2.4.2). The plugin registers **Querit as a websearch provider** — powering OpenCode's built-in `websearch` tool — plus a `web_fetch` custom tool for page content via `POST https://api.querit.ai/v1/contents`. It is the OpenCode counterpart of [`pi-querit`](https://www.npmjs.com/package/pi-querit) and [`dsh-querit`](https://www.npmjs.com/package/dsh-querit).

OpenCode v2 ships a built-in `websearch` tool with several providers (Exa, Firecrawl, Parallel, Tavily, TinyFish), each of which needs its own API key or a connected account. This plugin adds Querit to the provider list — use it with your own Querit API key.

Sign up on [Querit.ai](https://www.querit.ai) to get an API key with **1,000 free API calls per month** — no credit card required.

> Requires OpenCode v2 `2.0.28+`. On OpenCode v1 pin [`opencode-querit@1.0.2`](https://www.npmjs.com/package/opencode-querit/v/1.0.2); on a v2 host older than 2.0.28 pin [`opencode-querit@2.0.0`](https://www.npmjs.com/package/opencode-querit/v/2.0.0).

## Upgrading from 2.x

Version 3.0.0 makes two incompatible changes:

- **Host floor raised.** The plugin requires OpenCode 2.0.28+. From that release a rejected `web_fetch` call is reported as a normal tool failure instead of crashing the call, and from 2.3.0 stopping the call aborts the in-flight request.
- **`count` is no longer defaulted to 5.** When `count` is not set it is left out of the request and Querit's server default decides how many results come back. Set `count` if you relied on five results. The accepted range is now 1–100 (was 1–20).

The deprecated `chunksPerDoc: 1` is also no longer sent on every request: set `chunksPerDoc` to send it, or switch to `highlights`.

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
  "plugins": [{ "package": "file:///D:/work/querit/querit-plugins/opencode-querit" }]
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
      "highlights": true,
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
| `baseURL` | `https://api.querit.ai` | Querit API base, which must be an HTTP(S) URL; `/v1/search` and `/v1/contents` are appended. Falls back to `$QUERIT_BASE_URL`. |
| `timeoutMs` | `70000` | Deadline for one request in ms (minimum 1000), retries and backoff waits included. |
| `count` | unset | Result count per search (1–100). Unset: not sent, so Querit's server default applies. Querit caps it by plan (Free 10, PAYG 20, Enterprise 100). |
| `timeRange` | none | Relative (`d7`, `w2`, `m3`, `y1`, or any `dN`/`wN`/`mN`/`yN`) or `YYYY-MM-DDtoYYYY-MM-DD` date range. Set it for "latest"/"now"-style queries; a range has no spaces and the letter comes first. |
| `countries` | none | Country filter. Valid values: `argentina`, `australia`, `brazil`, `canada`, `colombia`, `france`, `germany`, `india`, `indonesia`, `japan`, `mexico`, `nigeria`, `philippines`, `south korea`, `spain`, `united kingdom`, `united states`. |
| `languages` | none | Language filter. Valid values: `english`, `japanese`, `korean`, `german`, `french`, `spanish`, `portuguese`, `russian`. |
| `includeDomains` | none | **Whitelist** hostnames; only these domains return results. |
| `excludeDomains` | none | **Blacklist** hostnames; these domains never return results. |
| `vertical` | unset | `code` or `finance`: vertical search over that domain's data source. Unset: universal search. Use it only for queries that belong to the domain — a mismatched vertical loses results. |
| `resourceTags` | none | Sub-tags of the `code` vertical to keep: `qa`, `github`. Requires `vertical: "code"`; any other setting fails plugin load. |
| `rank` | unset | `relevance` or `freshness`: a boost on top of Querit's default ranking, not a sort. Never sent together with `vertical: "code"`, which rejects it. |
| `highlights` | `false` | Ask Querit for query-focused fragments of each result's body (`highlights: true`); they are appended to the result content. The recommended replacement for `chunksPerDoc`. |
| `includeContent` | `false` | Request sentence-level body text (`needContent`); it is appended to each result's content. |
| `contentMaxChars` | unset | Cap on each search result's body text, in Unicode code points (1–1000000), applied by Querit. Sent only together with `includeContent`, the only case Querit reads it. |
| `needMarkdown` | `false` | Request Markdown versions of each result's snippet and body (`needMarkdown`). Enterprise plans only; silently ignored on other plans. When Querit returns them, the Markdown is used instead of the plain text. |
| `chunksPerDoc` | unset | Summary chunks per result (1–3; Free and PAYG plans accept 1). Deprecated by Querit in favor of `highlights`; sent only when set. |
| `fetchFormat` | `markdown` | Default format requested from `/v1/contents` for fetch calls: `markdown`, `text`, or `html`. Per-call `format` overrides it. |
| `fetchCrawlTimeout` | `10` | Per-page crawl timeout in seconds (1–60). Per-call `crawl_timeout` overrides it. |
| `fetchMaxChars` | `8000` | Cap applied locally to one fetched page's body, in chars; a cut page is flagged `truncated` in the tool metadata. |
| `maxOutputChars` | `200000` | Cap on one tool's rendered output / all search results' combined content, in chars. |

Invalid options fail plugin load with a message naming the option and its allowed values.

## What gets registered

### websearch provider (`querit`)

Powers OpenCode's built-in `websearch` tool. Each query is resolved with the current config and API key; the request is built from the plugin options, and anything you did not set is left out so Querit's server defaults apply. Results map to OpenCode's provider shape — `url`, `title`, `content` (the snippet, then highlights when `highlights` is on, then the body text when `includeContent` or `needMarkdown` is on), `published` when `page_age` is an unambiguous calendar date, which is read as UTC as Querit reports it. Every remote string is sanitized and capped (at most 4096 bytes per result, `maxOutputChars` across all results) before the model sees it. OpenCode renders the citations itself, so a successful search has no place to show `search_id` or cost; both appear on failures (below).

### web_fetch tool

```
url:                 A single HTTP(S) URL to fetch.
urls:                HTTP(S) URLs to fetch. At most 10 URLs per call.
format:              Returned content format (default: the fetchFormat option).
crawl_timeout:       Per-page crawl timeout in seconds, 1–60 (default: 10).
include_metadata:    Include page metadata such as title and publication time (default: true).
max_chars:           Maximum characters of content per page, 1–1000000, cut short by Querit.
                     Omit for the full page.
highlight_query:     Also return the passages of each page that answer this query.
highlight_max_chars: Maximum highlight characters per page, 100–8000.
```

Fetches page content for up to 10 HTTP(S) URLs through Querit's crawler. URLs with embedded credentials are rejected, and every fetched page is capped at `fetchMaxChars` chars. With `highlight_query` the matching passages of each page are listed above its content. The tool forwards OpenCode's abort signal, so an interrupted or stopped call cancels the request and any pending retry wait. Not every requested URL comes back: URLs without returned content are listed in the output.

OpenCode checks permission for this tool under its own name, `web_fetch`; the permission rule of the built-in `webfetch` tool does not cover it.

### Failures, retries, search_id and cost

Querit reports failures through `error_code`, and the plugin treats that code as the verdict even when the HTTP status is 200.

- **Retried:** 429, 500 and 503, at most twice (three requests in all), with exponential backoff and jitter (500 ms base, 5 s ceiling). A `Retry-After` header — delay-seconds or an HTTP-date — is honored when it fits under the 5 s ceiling; a longer one is not waited out, the call fails instead. On `/v1/contents`, a 503 usually means the server-side processing budget was exceeded: send fewer URLs or a lower `crawl_timeout`.
- **Never retried:** every other status, including 400, 401, 403 and 404. On `/v1/contents`, a 403 means there is no active Contents subscription or the prepaid quota is exhausted.
- **Deadline:** everything, retries and waits included, must finish within `timeoutMs`.
- **`search_id`:** every API failure message carries `[search_id: N]` when Querit sent one, so support can trace the request. For `web_fetch` it is also the `searchId` field of the tool metadata and the `Search ID: N` line of the output.
- **Cost:** for `web_fetch`, a reported charge is the `cost` field of the tool metadata (`{ currency, total }`) and the `Cost: USD 0.000000` line of the output, kept at six decimals so small charges stay visible. Both appear only when Querit reported a cost: an absent cost is unavailable and is never shown as zero, while a reported `0` is a real zero charge.

## Safety

Treat every search result and retrieved page as untrusted external data. Fetched pages are wrapped in explicit untrusted-content markers, terminal escape sequences and bidi controls are stripped from retrieved text, and the plugin never follows instructions found in retrieved content. Failures surface with the API key redacted; responses are size-limited (2 MiB search, 10 MiB contents).

## Development

Requires Node 22.19.0 or later.

```bash
npm install
npm run check      # typecheck src + tests
npm test           # vitest unit tests
npm run build      # tsc -> lib/
npm run pack:check # npm pack --dry-run
npm run test:live  # live smoke test against the real API (needs QUERIT_API_KEY)
```

## Packaging notes

`lib/` is committed: OpenCode loads npm plugins directly from the compiled package, and committing it lets users install from GitHub Release tarballs without a build toolchain. `@opencode/plugin` is an optional peer dependency (`>=2.0.28 <3`) used for types only — the compiled plugin is plain structural JavaScript that OpenCode v2 loads via `export default { id, setup }`, and the host supplies `@opencode/plugin` at runtime. `zod` (4.2.0 or later) is the only runtime dependency: from 4.2.0 its schemas expose the JSON Schema hook OpenCode calls to describe a plugin tool's input to the model.

## License

MIT
