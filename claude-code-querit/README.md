# claude-code-querit

[![license](https://img.shields.io/badge/license-MIT-yellow.svg)](./LICENSE)

A production-oriented [Claude Code](https://code.claude.com/docs/en/plugins) plugin that gives Claude two Querit-backed MCP tools:

- `web_search` for live web search with source URLs
- `fetch_content` for clean full-page text, Markdown, or HTML

It also includes one focused `/querit:research` skill for source-grounded research and citations. The plugin calls `POST https://api.querit.ai/v1/search` and `/v1/contents` through a bundled stdio MCP server.

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

Or non-interactively, supplying the key in the same step:

```bash
claude plugin marketplace add querit-ai/querit-plugins
claude plugin install querit-ai@querit --config api_key=<your-key>
```

The plugin declares an optional, sensitive `api_key` option. Leave it unset if you use the `QUERIT_API_KEY` environment variable, which takes precedence (see [API key priority](#api-key-priority)).

For local development from this repository, load the plugin with `--plugin-dir`. The plugin root is the `plugin/` subdirectory, not the package root:

```bash
claude --plugin-dir ./claude-code-querit/plugin
```

`--plugin-dir` skips the install flow. The server takes the key from `QUERIT_API_KEY` in the environment when present; to use the plugin option instead, configure it through `/plugin` inside the session, or pass it up front with a settings file for headless and scripted runs:

```json dev-settings.json
{ "pluginConfigs": { "querit@inline": { "options": { "api_key": "your-key" } } } }
```

```bash
claude --plugin-dir ./claude-code-querit/plugin --settings ./dev-settings.json
```

Keep that file out of version control. `querit-ai@inline` is the plugin ID that `claude --plugin-dir ./claude-code-querit/plugin plugin list` prints; a marketplace install uses `querit-ai@querit` instead.

Then use `/mcp` to confirm that the plugin-provided `querit` server is connected. Run `/reload-plugins` after changing `.mcp.json`, the manifest, or MCP code.

### Where the API key is stored

`api_key` is declared `sensitive`, so Claude Code keeps it out of `settings.json` and out of this repository:

- **macOS:** the login Keychain, shared with Claude Code's OAuth tokens.
- **Windows and Linux:** `~/.claude/.credentials.json`, because no supported keychain is available there.
- **Delivery to the server:** `.mcp.json` substitutes the stored value into `CLAUDE_PLUGIN_OPTION_API_KEY` in the MCP server process environment. Nothing else in the session receives it.

Change or clear the key with `/plugin` → Querit → `api_key`, or reinstall with `--config api_key=<key>`. Keychain storage has a roughly 2 KB shared limit, which a Querit key is far below.

### API key priority

The server resolves a non-empty key for every tool call in this order:

1. `QUERIT_API_KEY` — environment variable, inherited by the MCP server process
2. `CLAUDE_PLUGIN_OPTION_API_KEY` — populated by `.mcp.json` from the sensitive `userConfig.api_key` value

Note that a stale `QUERIT_API_KEY` therefore overrides the plugin option; unset it if you switch to `userConfig.api_key`.

Do not put a literal key in `.mcp.json`, source files, shell history, chat, or logs. Tool errors redact the active key before they reach Claude.

## Tools

Claude Code scopes plugin MCP names internally, but Claude can select these tools from their descriptions without the user typing the full scoped name.

### `web_search`

| Parameter | Required | Description |
|---|---:|---|
| `query` | yes | Search query, 1–1,000 characters |
| `count` | no | Maximum results, 1–20; default `5` |

Results include titles, normalized HTTP(S) URLs, snippets, dates/site names when available, and optional server identifiers. Duplicate and non-HTTP(S) results are dropped.

### `fetch_content`

| Parameter | Required | Description |
|---|---:|---|
| `urls` | yes | Array of 1–10 HTTP(S) URLs |
| `format` | no | `text`, `markdown`, or `html`; default `markdown` |
| `crawl_timeout` | no | Per-page crawl timeout in seconds, 1–60; default `10` |
| `include_metadata` | no | Include title/publication metadata; default `true` |

A call accepts at most 10 unique URLs. URLs with embedded credentials or non-HTTP(S) schemes are rejected before any API request.

## Research skill

Invoke the focused research workflow directly:

```text
/querit:research recent changes to the Node.js permission model
```

Claude can also load it automatically when a request needs current facts, authoritative sources, verification, or citations. The skill instructs Claude to prefer primary sources, fetch pages when snippets are insufficient, cross-check consequential claims, distinguish inference from sourced facts, and cite returned URLs.

## Safety and limits

All remote text is untrusted. Every successful tool response starts with an explicit warning, fetched page bodies are wrapped in untrusted-content delimiters, and the skill tells Claude to ignore instructions embedded in web content.

The MCP server also:

- strips ANSI/terminal control sequences, control strings, unsafe C0/C1 controls, and bidirectional text controls;
- redacts the active API key from HTTP, parse, network, and handler error surfaces;
- limits API responses to 2 MiB for search, 10 MiB for contents, and 8 KiB for error bodies;
- caps each fetched page at 8,000 characters and each rendered tool result at 200,000 characters;
- applies a 70-second API request timeout and a 90-second Claude Code MCP tool timeout;
- deduplicates response URLs and accepts only credential-free HTTP(S) URLs.

These controls reduce risk and output size, but they do not make web content trusted. Review sources before relying on high-impact claims.

## Package layout

Everything Claude Code copies on install lives under `plugin/`; everything above it is development-only and never reaches a user's machine.

```text
claude-code-querit/
├── plugin/                          # <- the plugin root Claude Code installs
│   ├── .claude-plugin/plugin.json   # Plugin metadata and sensitive userConfig
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

`npm run pack` inspects the tarball with `--ignore-scripts`, so it deliberately skips the `prepack` hook and does not re-verify. A real `npm publish` runs `prepack`, and therefore the full chain, first.

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

Inside the session, inspect `/mcp`, invoke `/querit:research`, and exercise both tools. The automated structure checks remain useful in environments where the Claude CLI is unavailable, but they are not a substitute for Claude Code's own validator.

## License

MIT
