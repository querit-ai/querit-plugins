# claude-code-querit

[![license](https://img.shields.io/badge/license-MIT-yellow.svg)](./LICENSE)

A production-oriented [Claude Code](https://code.claude.com/docs/en/plugins) plugin that gives Claude two Querit-backed MCP tools:

- `web_search` for live web search with source URLs
- `fetch_content` for clean full-page text, Markdown, or HTML

It also includes one focused `/querit-ai:research` skill for source-grounded research and citations. The plugin calls `POST https://api.querit.ai/v1/search` and `/v1/contents` through a bundled stdio MCP server.

Sign up at [Querit.ai](https://www.querit.ai) to get an API key with **1,000 free API calls per month**. No credit card is required.

## Requirements

- Claude Code with plugin support
- Node.js 22.19.0 or newer available as `node`
- A Querit API key

Plugin installations do **not** download anything. `plugin/dist/server.js` is committed and already contains the MCP SDK, schema validation, and every other runtime dependency. The `plugin/` directory also carries no `package.json`, which is what keeps Claude Code from running its automatic dependency install on the copy it caches.

## Install and configure

The repository root doubles as a Claude Code marketplace, so install the plugin from there:

```text
/plugin marketplace add querit-ai/querit-plugins
/plugin install querit-ai@querit
```

Or non-interactively:

```bash
claude plugin marketplace add querit-ai/querit-plugins
claude plugin install querit-ai@querit
```

The plugin takes its API key from the `QUERIT_API_KEY` environment variable only (see [API key](#api-key)). Set it before starting Claude Code so the MCP server process inherits it.

For local development from this repository, load the plugin with `--plugin-dir`. The plugin root is the `plugin/` subdirectory, not the package root:

```bash
claude --plugin-dir ./claude-code-querit/plugin
```

`--plugin-dir` skips the install flow; the server still takes the key from `QUERIT_API_KEY` in the environment. `querit-ai@inline` is the plugin ID that `claude --plugin-dir ./claude-code-querit/plugin plugin list` prints; a marketplace install uses `querit-ai@querit` instead.

Then use `/mcp` to confirm that the plugin-provided `querit` server is connected. Run `/reload-plugins` after changing `.mcp.json`, the manifest, or MCP code.

### API key

The server reads the key from the `QUERIT_API_KEY` environment variable on every tool call. It is the plugin's only configuration. Every `web_search` option beyond the query — `count`, highlights, body text, ranking, vertical — is a per-call parameter with no stored default; `fetch_content` falls back to `format: markdown`, `crawl_timeout: 10`, and `include_metadata: true`. Claude Code spawns the MCP server as a child process, so the variable set in the environment that launches Claude Code is inherited — set it at user or machine scope (on Windows, `setx QUERIT_API_KEY <key>` and open a new terminal) or export it from your shell profile.

There is deliberately no in-product `userConfig` option: one environment variable keeps local development, CI, and UI installs on a single code path, and nothing credential-shaped is written into plugin settings.

Do not put a literal key in `.mcp.json`, source files, shell history, chat, or logs. Tool errors redact the active key before they reach Claude.

## Tools

Claude Code scopes plugin MCP names internally, but Claude can select these tools from their descriptions without the user typing the full scoped name.

### `web_search`

| Parameter | Required | Description |
|---|---:|---|
| `query` | yes | Search query, 1–1,000 characters |
| `count` | no | Maximum results, 1–100. Omit to use Querit's own default count |
| `highlights` | no | Return query-focused fragments of each result's body text (default `false`). Also enabled by `highlight_query` or `highlight_max_chars` |
| `highlight_query` | no | What the highlights focus on, 1–1,000 characters; defaults to the search query |
| `highlight_max_chars` | no | Upper bound on highlighted characters, 100–8,000 |
| `need_content` | no | Include each result's body text as content excerpts (default `false`) |
| `max_chars` | no | Limit the body text per result, in Unicode code points, 1–1,000,000. Requires `need_content`; omit for the full body |
| `need_markdown` | no | Request Markdown versions of the snippet and body text (default `false`). Enterprise plans only; Querit ignores it on other plans |
| `rank` | no | `relevance` or `freshness`: a boost on top of Querit's ranking, not a sort |
| `vertical` | no | `code` or `finance`. Omit for universal search; a mismatched vertical loses results |

Optional request fields are sent only when asked for, so Querit's own defaults apply. The plugin never sends `count` unless one is given and no longer sends the deprecated `chunksPerDoc`; `highlights` is its replacement.

Querit rejects `rank` together with `vertical: "code"` (HTTP 400), so the plugin withholds `rank` for that vertical and says so in the output.

Results include titles, normalized HTTP(S) URLs, snippets, site names, the page time as Querit reports it in UTC, and the highlights, body excerpts, or Markdown that were requested. Duplicate and non-HTTP(S) results are dropped. The header carries the search ID, and the cost at six decimals when Querit reports one; a missing cost means unavailable, not free.

### `fetch_content`

| Parameter | Required | Description |
|---|---:|---|
| `urls` | yes | Array of 1–10 HTTP(S) URLs |
| `format` | no | `text`, `markdown`, or `html`; default `markdown` |
| `crawl_timeout` | no | Per-page crawl timeout in seconds, 1–60; default `10` |
| `include_metadata` | no | Include title/publication metadata; default `true` |
| `max_chars` | no | Limit each page's content to at most this many characters, 1–1,000,000, applied by Querit per URL. Omit for the full page |
| `highlight_query` | no | Return the passages of each page that are relevant to this query, 1–1,000 characters |
| `highlight_max_chars` | no | Upper bound on highlighted characters per URL, 100–8,000 |

Highlights are requested only when `highlight_query` or `highlight_max_chars` is present. Without `max_chars` the plugin requests the full page and truncates its own output at 8,000 characters per page, with a marker; with `max_chars`, Querit enforces the limit and the plugin applies no per-page cap of its own.

A call accepts at most 10 unique URLs. URLs with embedded credentials or non-HTTP(S) schemes are rejected before any API request.

## Research skill

Invoke the focused research workflow directly:

```text
/querit-ai:research recent changes to the Node.js permission model
```

Claude can also load it automatically when a request needs current facts, authoritative sources, verification, or citations. The skill instructs Claude to prefer primary sources, fetch pages when snippets are insufficient, cross-check consequential claims, distinguish inference from sourced facts, and cite returned URLs.

## Safety and limits

All remote text is untrusted. Every successful tool response starts with an explicit warning, fetched page bodies are wrapped in untrusted-content delimiters, and the skill tells Claude to ignore instructions embedded in web content.

The MCP server also:

- strips ANSI/terminal control sequences, control strings, unsafe C0/C1 controls, and bidirectional text controls;
- redacts the active API key from HTTP, parse, network, and handler error surfaces;
- takes Querit's `error_code` as the verdict of a request, checking it even on an HTTP 200, and ends every failure message with the request's `search_id` when Querit supplied one, so support can trace the request;
- retries only 429, 500, and 503, by that `error_code`: at most twice, with exponential backoff and jitter (500 ms base, 5 s ceiling), honoring `Retry-After` (delay-seconds or HTTP-date) up to that ceiling. A longer `Retry-After` fails the call instead of blocking, and 400, 401, 403, and 404 are never retried;
- limits API responses to 2 MiB for search, 10 MiB for contents, and 8 KiB for error bodies;
- caps each fetched page at 8,000 characters unless `max_chars` is given, and each rendered tool result at 200,000 characters;
- applies one 70-second API deadline per tool call, retries and backoff waits included, under a 90-second Claude Code MCP tool timeout;
- deduplicates response URLs and accepts only credential-free HTTP(S) URLs.

These controls reduce risk and output size, but they do not make web content trusted. Review sources before relying on high-impact claims.

## Package layout

Everything Claude Code copies on install lives under `plugin/`; everything above it is development-only and never reaches a user's machine.

```text
claude-code-querit/
├── plugin/                          # <- the plugin root Claude Code installs
│   ├── .claude-plugin/plugin.json   # Plugin metadata
│   ├── .mcp.json                    # Starts the bundled stdio server
│   ├── dist/server.js               # Committed, self-contained Node.js bundle
│   ├── skills/research/SKILL.md     # Citation-focused research workflow
│   └── LICENSE
├── src/                             # TypeScript implementation
├── tests/                           # Client, handlers, MCP, bundle, and structure tests
├── scripts/                         # Build, verification, and gated live smoke test
└── package.json                     # Development tooling only
```

The plugin intentionally has no hooks or agents. `npm run verify:plugin` fails if a `package.json`, lockfile, or `node_modules` ever appears inside `plugin/`, because Claude Code would then run `npm ci --ignore-scripts` on every install and pull the build and test tooling onto users' machines.

## Development

```bash
npm ci
npm run verify
npm run pack
```

`npm run verify` is the full chain: `check`, `build`, tests, and `verify:plugin`. Run the steps individually while iterating. The bundle test copies `plugin/dist/server.js` outside the package and performs an MCP stdio handshake, which catches accidental unbundled runtime imports.

`npm run pack` runs `npm pack --dry-run --ignore-scripts`, which only lists the tarball. npm runs the `prepack` script before any script named `pack`, so the full chain runs first; `--ignore-scripts` keeps the dry-run `npm pack` itself from running lifecycle scripts again. A real `npm publish` runs the same `prepack` chain.

Run the paid, networked smoke test only when explicitly enabled:

```bash
QUERIT_LIVE_SMOKE=1 QUERIT_API_KEY="your-key" npm run test:live
```

Without `QUERIT_LIVE_SMOKE=1`, the script exits successfully without making a request. It reports only pass/fail counts and never prints the key or fetched content.

### Local Claude Code validation

With Claude Code installed, run:

```bash
claude plugin validate ./claude-code-querit/plugin --strict
claude --plugin-dir ./claude-code-querit/plugin
```

Inside the session, inspect `/mcp`, invoke `/querit-ai:research`, and exercise both tools. The automated structure checks remain useful in environments where the Claude CLI is unavailable, but they are not a substitute for Claude Code's own validator.

## License

MIT
