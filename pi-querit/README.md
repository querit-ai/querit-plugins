# pi-querit

[![npm version](https://img.shields.io/npm/v/pi-querit?color=blue)](https://www.npmjs.com/package/pi-querit)
[![downloads](https://img.shields.io/npm/dm/pi-querit)](https://www.npmjs.com/package/pi-querit)
[![license](https://img.shields.io/npm/l/pi-querit)](./LICENSE)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![pi](https://img.shields.io/badge/pi-extension-orange)

A focused [Pi](https://github.com/earendil-works/pi) extension that gives your agent live web search and page fetching through [Querit](https://www.querit.ai).

## Why Querit?

LLMs are limited by their training data — complex or real-time queries lead to hallucinations and stale answers. Querit is a retrieval system built specifically for generative LLM invocation scenarios, delivering real-time, authoritative web search results that integrate directly into LLM applications:

- **Comprehensive content** — a massive global index spanning nearly 20 countries and 10 languages with hundreds of billions of web pages.
- **Strong capabilities** — flexible retrieval options (time range, region, language, and domain filters) so results can be tuned for specific scenarios.
- **Excellent results** — accurate, authoritative, high-quality content coverage.

Sign up on [Querit.ai](https://www.querit.ai) to get an API key with **1,000 free API calls per month** — no credit card required.

## Quick Start

**1. Install**

```bash
pi install npm:pi-querit
```

**2. Configure**

Start Pi interactively and run the setup wizard:

```text
/querit-setup
```

The wizard walks you through API key entry and search defaults. Every step after the API key can be skipped.

**3. Search**

Just ask your agent anything that needs the web — it calls `web_search` and `fetch_content` automatically:

```text
> What changed in the Rust 2024 edition?
```

> **Note:** Do not enable this package together with another extension that also registers `web_search` or `fetch_content`; Pi tool names must be unique.

## How It Works

```
┌──────────────────────────────────────────────────────────┐
│  Pi Agent                                                │
│                                                          │
│  web_search(query, count?)                               │
│      │                                                   │
│      ▼                                                   │
│  ┌─────────────┐    persistent defaults     ┌─────────┐  │
│  │  Querit API  │◄── (timeRange, countries, │ querit-  │  │
│  │  /v1/search  │    languages, domains…)   │ search.  │  │
│  └──────┬──────┘    from /querit-setup      │ json     │  │
│         │                                   └─────────┘  │
│         ▼                                                │
│    return cited results to the model                     │
│                                                          │
│  fetch_content(url/urls, format?)                        │
│      │                                                   │
│      ▼                                                   │
│  ┌──────────────────┐                                    │
│  │  Querit API       │                                   │
│  │  /v1/contents     │──► markdown / text / HTML         │
│  └──────────────────┘    (up to 10 URLs per call)        │
└──────────────────────────────────────────────────────────┘
```

The extension registers two tools and one slash command:

| Surface | Purpose |
|---|---|
| `web_search` | Live web search with cited results |
| `fetch_content` | Full page content (markdown, text, or HTML) for up to 10 URLs per call |
| `/querit-setup` | Interactive configuration of the API key and persistent search defaults |

## Configuration

Run `/querit-setup` in Pi's interactive mode. Configuration is stored in `~/.pi/agent/querit-search.json` (respects `PI_CODING_AGENT_DIR`).

### First-time setup flow

1. **API key** — masked input prompt; validated with a one-result search request.
2. **Search defaults** — each step can be skipped (see table below).

### Re-configuration menu

When a key is already configured, `/querit-setup` opens a menu:

| Option | Effect |
|---|---|
| **Replace API key (full re-setup)** | Prompts for a new key, validates it, re-runs the full flow. The old key is overwritten locally; revoke it in the Querit dashboard if needed. |
| **Change search defaults** | Edits the persistent search filters without touching the saved key. |

### Search default options

These are persistent defaults applied to every `web_search` call. They are stored under the `search` key in `querit-search.json` and are **not** per-call parameters.

| Option | Values | Default | Description |
|---|---|---|---|
| `count` | `1` – `100` | Querit's server default (left unset) | Number of results per search. Can be overridden per call via the `count` parameter. |
| `timeRange` | `d7` · `w2` · `m3` · `y1` | *(none — all time)* | Restrict results to the past 7 days, 2 weeks, 3 months, or 1 year. |
| `includeContent` | `yes` / `no` | `no` | Include sentence-level body text in results for richer context (`needContent`). |
| `countries` | `argentina` · `australia` · `brazil` · `canada` · `colombia` · `france` · `germany` · `india` · `indonesia` · `japan` · `mexico` · `nigeria` · `philippines` · `south korea` · `spain` · `united kingdom` · `united states` | *(none — global)* | Bias results toward specific countries. Comma-separated, multi-select. |
| `languages` | `english` · `japanese` · `korean` · `german` · `french` · `spanish` · `portuguese` · `russian` | *(none — all)* | Filter results by language. Comma-separated, multi-select. |
| `includeDomains` | domain list | *(none — unrestricted)* | **Whitelist** — only these domains return results. |
| `excludeDomains` | domain list | *(none)* | **Blacklist** — these domains are excluded. Ships with a built-in **Noise blockers** preset: `pinterest.com`, `facebook.com`, `instagram.com`, `tiktok.com`. |

#### Advanced options

These are set by editing `querit-search.json`; the setup wizard does not prompt for them.

| Option | Values | Default | Description |
|---|---|---|---|
| `highlights` | `true` / `false` | *(off)* | Ask Querit for query-focused fragments of each page's body text. Usually the best answer to "the snippet is too short", and cheaper to read than whole pages. |
| `contentMaxChars` | `1` – `1000000` | *(full body text)* | With `includeContent: true`, cap the body text returned per result, in Unicode code points. Ignored otherwise. |
| `rank` | `relevance` · `freshness` | *(Querit's default ranking)* | A nudge on top of the default ranking, not a sort. Automatically dropped for `vertical: "code"` searches, which reject it. |
| `needMarkdown` | `true` / `false` | *(off)* | Enterprise plans only: return `snippet_markdown` and `content_markdown`. Querit ignores it on other plans. |
| `chunksPerDoc` | `1` – `3` | *(off)* | **Deprecated by Querit.** Kept so existing configurations keep working; migrate to `highlights`. Free and PAYG plans support at most `1`. |

### Configuration file example

```json
{
  "apiKey": "your-api-key",
  "search": {
    "count": 5,
    "timeRange": "m3",
    "includeContent": true,
    "contentMaxChars": 2000,
    "highlights": true,
    "countries": ["united states"],
    "languages": ["english"],
    "includeDomains": ["github.com"],
    "excludeDomains": ["pinterest.com"]
  }
}
```

The extension applies mode `0600` on POSIX systems. On Windows, the file remains protected by the user profile's filesystem ACLs. The key is never included in tool results or logs.

For CI or ephemeral use, set `QUERIT_API_KEY`. The environment variable takes precedence when both are present.

## Tools

### `web_search`

Required:

- `query`

Optional:

- `count` (`1..100`) — overrides the configured default for one call
- `vertical` — `"code"` for programming questions or `"finance"` for markets, listed companies, and macro-economics. Querit routes these to a vertical data source; a mismatched vertical loses results, so leave it out for everything else.

Domains, time range, countries, languages, and content detail are persistent defaults configured in `/querit-setup` (stored under `search` in `querit-search.json`), not per-call parameters. Skipping the domain lists leaves search unrestricted; the include list is a whitelist (only those domains return results), the exclude list is a blacklist.

When nothing sets `count`, the extension sends none and Querit applies its server default.

Results include explicit title, URL, snippet, source metadata, optional sentence excerpts, and optional highlights. Duplicate and non-HTTP(S) result URLs are removed. When Querit reports a per-request cost, it is shown on the result line at full precision; an absent cost means unavailable, not free.

### `fetch_content`

Pass `url`, `urls`, or both (at most 10 unique HTTP(S) URLs).

Optional:

- `format`: `markdown` (default), `text`, or `html`
- `crawl_timeout`: `1..60` seconds (default `10`)
- `include_metadata`: default `true`
- `max_chars` (`1..1000000`) — keep only the beginning of each page. Markup counts, so truncated markdown or HTML can end mid-tag; use `text` for a clean prefix.
- `highlight_query` — return only the passages relevant to this, extracted from the full page
- `highlight_max_chars` (`100..8000`) — cap the highlighted characters per URL; Querit picks a length when omitted

Both tools mark remote data as untrusted, propagate Pi cancellation, enforce response-size limits, and cap model-visible output at Pi's 50KB/2000-line limit. If formatted output is truncated, the complete output is written to a uniquely named file inside a per-user temp folder (`pi-querit-<uid>` in the OS temp directory), readable only by that user. To keep search content private, that folder never accumulates files: the files a Pi process creates are deleted when that session shuts down (with a process-exit fallback), and leftovers from crashed runs are swept the next time the extension loads.

Failures carry Querit's `search_id`, which its support team uses to trace a request. HTTP 429, 500, and 503 are retried with bounded exponential backoff, honoring `Retry-After`; 400, 401, 403, and 404 are never retried.

## Development

Requires Node.js 22.19 or newer. Type-checked and tested against Pi 1.6.1.

```bash
npm install
npm run check
npm test
npm run pack:check
```

A live smoke test reads the same JSON configuration (or `QUERIT_API_KEY`) and exercises both APIs without printing the key or fetched content:

```bash
npm run test:live
```

## License

MIT
