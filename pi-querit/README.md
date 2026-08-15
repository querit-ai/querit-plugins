# pi-querit

[![npm version](https://img.shields.io/npm/v/pi-querit?color=blue)](https://www.npmjs.com/package/pi-querit)
[![downloads](https://img.shields.io/npm/dm/pi-querit)](https://www.npmjs.com/package/pi-querit)
[![license](https://img.shields.io/npm/l/pi-querit)](./LICENSE)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![pi](https://img.shields.io/badge/pi-extension-orange)

English | [中文](./README-zh.md)

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

The wizard walks you through API key entry, search defaults, and an optional summary model. Every step after the API key can be skipped.

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
│  web_search(query, count?, workflow?)                    │
│      │                                                   │
│      ▼                                                   │
│  ┌─────────────┐    persistent defaults     ┌─────────┐  │
│  │  Querit API  │◄── (timeRange, countries, │ querit-  │  │
│  │  /v1/search  │    languages, domains…)   │ search.  │  │
│  └──────┬──────┘    from /querit-setup      │ json     │  │
│         │                                   └─────────┘  │
│         ▼                                                │
│  workflow = raw?──► return cited results to outer model   │
│         │                                                │
│  workflow = summary?                                     │
│         │                                                │
│         ▼                                                │
│  ┌──────────────────┐                                    │
│  │ Fixed Pi model    │  nested LLM call                  │
│  │ (from setup)      │  → concise summary + sources      │
│  └──────────────────┘  + key excerpts                    │
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
| `web_search` | Live web search with cited results; optionally pre-summarized by a fixed Pi model |
| `fetch_content` | Full page content (markdown, text, or HTML) for up to 10 URLs per call |
| `/querit-setup` | Interactive configuration of the API key, persistent search defaults, workflow, and summary model |

**`raw` vs `summary` workflow:**

- **`raw`** (recommended) — Pi's outer model receives the cited Querit results and answers normally.
- **`summary`** — one additional nested LLM call using the fixed model selected in `/querit-setup` produces a concise summary (preserving version numbers, API signatures, error messages, and verbatim quotes), followed by a Sources list and a `## Key excerpts` section with the top five results' raw snippets. If the fixed model is missing, unauthenticated, times out (30 s), or returns empty output, the tool falls back to raw results and reports the reason.

## Configuration

Run `/querit-setup` in Pi's interactive mode. Configuration is stored in `~/.pi/agent/querit-search.json` (respects `PI_CODING_AGENT_DIR`).

### First-time setup flow

1. **API key** — masked input prompt; validated with a one-result search request.
2. **Search defaults** — each step can be skipped (see table below).
3. **Workflow** — choose `raw` or `summary` as the default.
4. **Summary model** *(summary only)* — interactive model picker (five per page, arrow-key navigation, type-to-filter fuzzy matching, active model first), then a thinking intensity selector filtered to the levels the chosen model supports.

### Re-configuration menu

When a key is already configured, `/querit-setup` opens a menu:

| Option | Effect |
|---|---|
| **Replace API key (full re-setup)** | Prompts for a new key, validates it, re-runs the full flow. The old key is overwritten locally; revoke it in the Querit dashboard if needed. |
| **Change search defaults** | Edits the persistent search filters without touching the saved key. |
| **Change summary settings** | Edits the default workflow, the fixed summary model, and its thinking intensity. |

### Search default options

These are persistent defaults applied to every `web_search` call. They are stored under the `search` key in `querit-search.json` and are **not** per-call parameters.

| Option | Values | Default | Description |
|---|---|---|---|
| `count` | `1` – `20` | API default (`5`) | Number of results per search. Can be overridden per call via the `count` parameter. |
| `timeRange` | `d7` · `w2` · `m3` · `y1` | *(none — all time)* | Restrict results to the past 7 days, 2 weeks, 3 months, or 1 year. |
| `includeContent` | `yes` / `no` | `no` | Include sentence-level content excerpts in results for richer context. |
| `countries` | `argentina` · `australia` · `brazil` · `canada` · `colombia` · `france` · `germany` · `india` · `indonesia` · `japan` · `mexico` · `nigeria` · `philippines` · `south korea` · `spain` · `united kingdom` · `united states` | *(none — global)* | Bias results toward specific countries. Comma-separated, multi-select. |
| `languages` | `english` · `japanese` · `korean` · `german` · `french` · `spanish` · `portuguese` | *(none — all)* | Filter results by language. Comma-separated, multi-select. |
| `includeDomains` | domain list | *(none — unrestricted)* | **Whitelist** — only these domains return results. |
| `excludeDomains` | domain list | *(none)* | **Blacklist** — these domains are excluded. Ships with a built-in **Noise blockers** preset: `pinterest.com`, `facebook.com`, `instagram.com`, `tiktok.com`. |

### Summary settings

| Option | Values | Description |
|---|---|---|
| `defaultWorkflow` | `raw` · `summary` | Default workflow for `web_search`. Can be overridden per call via the `workflow` parameter. |
| `summaryModel` | any Pi model reference | Fixed model used for the nested summary call (e.g. `anthropic/claude-sonnet-4-20250514`). |
| `summaryThinkingLevel` | model-dependent | Thinking intensity for the summary model (e.g. `off`, `low`, `medium`, `high`). Defaults to `medium`; the picker only shows levels the chosen model supports. |

### Configuration file example

```json
{
  "apiKey": "your-api-key",
  "defaultWorkflow": "raw",
  "summaryModel": "provider/model-id",
  "summaryThinkingLevel": "medium",
  "search": {
    "count": 5,
    "timeRange": "m3",
    "includeContent": false,
    "countries": ["united states"],
    "languages": ["english"],
    "includeDomains": ["github.com"],
    "excludeDomains": ["pinterest.com"]
  }
}
```

The extension applies mode `0600` on POSIX systems. On Windows, the file remains protected by the user profile's filesystem ACLs. The key is never included in tool results or logs.

For CI or ephemeral use, set `QUERIT_API_KEY`. The JSON configuration takes precedence when both are present.

## Tools

### `web_search`

Required:

- `query`

Optional:

- `count` (`1..20`) — overrides the configured default for one call (API default: `5`)
- `workflow`: `raw` or `summary`; overrides the setup default for one call

Domains, time range, countries, languages, and content excerpts are persistent defaults configured in `/querit-setup` (stored under `search` in `querit-search.json`), not per-call parameters. Skipping the domain lists leaves search unrestricted; the include list is a whitelist (only those domains return results), the exclude list is a blacklist.

Results include explicit title, URL, snippet, source metadata, and optional sentence excerpts. Duplicate and non-HTTP(S) result URLs are removed.

### `fetch_content`

Pass `url`, `urls`, or both (at most 10 unique HTTP(S) URLs).

Optional:

- `format`: `markdown` (default), `text`, or `html`
- `crawl_timeout`: `1..60` seconds (default `10`)
- `include_metadata`: default `true`

Both tools mark remote data as untrusted, propagate Pi cancellation, enforce response-size limits, and cap model-visible output at Pi's 50KB/2000-line limit. If formatted output is truncated, the complete output is written to a unique temporary file and its path is returned.

## Development

Requires Node.js 22.19 or newer.

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
