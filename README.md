# querit-plugins

Official [Querit](https://www.querit.ai) search integrations for automation and AI agent platforms.

[Querit](https://www.querit.ai) delivers real-time, authoritative web search results and clean page content for LLM applications. Each integration in this repository connects one platform to the Querit API (`/v1/search` + `/v1/contents`) for live web search and page fetching — with cited sources, domain/region/language/time-range filters, and output that is always treated as untrusted web data.

| Platform | Package | Install |
| --- | --- | --- |
| [Pi](https://github.com/earendil-works/pi) | `pi-querit` | `pi install npm:pi-querit` |
| [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/cordis) | `dsh-querit` | `dsh plugin --profile web add dsh-querit` |
| [OpenCode](https://opencode.ai) | `opencode-querit` | `"plugin": ["opencode-querit"]` |
| [Claude Code](https://code.claude.com/docs/en/plugins) | `claude-code-querit` | `/plugin marketplace add querit-ai/querit-plugins` |
| [n8n](https://n8n.io) | `n8n-nodes-querit` | Install as an n8n community node |

Two more integrations live in this repository but are not generally available yet:

| Platform | Directory | Status |
| --- | --- | --- |
| [Zapier](https://zapier.com) | `zapier-querit/` | Complete and locally validated; awaiting registration and Zapier public review |
| [Browserbase](https://www.browserbase.com) | `browserbase-querit-demo/` | Reference demo, not a published package |

How each integration reads the API key and search defaults is covered in its own section below.

## Get an API key

Sign up on [Querit.ai](https://www.querit.ai) to get an API key with **1,000 free API calls per month** — no credit card required. The same key works for all integrations.

## pi-querit — Pi

A Pi extension that registers `web_search` and `fetch_content` as first-class tools. Your agent calls them automatically whenever an answer needs the live web.

**Install**

```bash
pi install npm:pi-querit
```

**API key**

Run the interactive setup wizard inside Pi once:

```text
/querit-setup
```

The wizard validates the key, then lets you configure persistent search defaults (result count, time range, countries, languages, domain whitelist/blacklist) and an optional fixed-model auto-summary workflow. Everything except the API key can be skipped.

- **Where the key lives:** `~/.pi/agent/querit-search.json` (respects `PI_CODING_AGENT_DIR`), written with mode `0600` on POSIX.
- **CI / ephemeral alternative:** set the `QUERIT_API_KEY` environment variable. The environment variable takes precedence when both are present.
- **Never put the key in chat or logs:** the extension masks key input and redacts the key from every error surface.

See the [pi-querit README](./pi-querit/README.md) for the full tool reference.

## dsh-querit — DeepSeek Harness

A provider package for the DeepSeek Harness `ctx.web` capability seam. It does not register the model-facing `web_search` tool; the agent preset does. By default, it reuses the official `applyWebFetchTool` helper to register `web_fetch`, and routes both tools through Querit-backed providers.

**Install**

```bash
dsh plugin --profile web add dsh-querit
```

Then wire it in the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: web-search-querit
      name: 'dsh-querit'
      config:
        apiKeyEnv: QUERIT_API_KEY
- id: web
  config:
    searchProvider: querit
    fetchProvider: querit
```

**API key** — resolved per operation in priority order:

1. `QUERIT_API_KEY` exported in the launching environment, or
2. the credentials store `$DSH_HOME/.credentials.yaml` (`QUERIT_API_KEY: <key>`, hot-reloaded), or
3. a literal `apiKey` on the `web-search-querit` row (least preferred — secrets should not live in composition files).

Search defaults (`count`, `timeRange`, `countries`, `languages`, `includeDomains`, `excludeDomains`, `includeContent`, `chunksPerDoc`, fetch format/timeouts) are configured on the plugin row or in the hot-reloaded `$DSH_HOME/settings.yaml` `web-search-querit:` section.

See the [dsh-querit README](./dsh-querit/README.md) for the full config table.

## opencode-querit — OpenCode

An OpenCode plugin that registers `web_search` and `web_fetch` as custom tools next to the built-ins. Additive: OpenCode's own `websearch`/`webfetch` stay available.

**Install**

Add the plugin to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-querit"]
}
```

Then restart OpenCode.

**API key** — resolved per tool call in priority order:

1. `QUERIT_API_KEY` environment variable (default; rename via `apiKeyEnv`), or
2. `apiKey` in the plugin options tuple (least preferred — secrets should not live in config files):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-querit", { "count": 8, "timeRange": "m3", "languages": ["english"] }]
  ]
}
```

Search defaults and fetch behavior are configured the same way (`count`, `timeRange`, `countries`, `languages`, `includeDomains`, `excludeDomains`, `includeContent`, `chunksPerDoc`, `fetchFormat`, `fetchCrawlTimeout`, `fetchMaxChars`, `maxOutputChars`).

See the [opencode-querit README](./opencode-querit/README.md) for the full config table and local-testing instructions.

## claude-code-querit — Claude Code

A Claude Code plugin that bundles a stdio MCP server exposing `web_search` and `fetch_content`, plus a `/querit-ai:research` skill for source-grounded answers with citations.

**Install**

```text
/plugin marketplace add querit-ai/querit-plugins
/plugin install querit-ai@querit
```

**API key** — the plugin reads only the `QUERIT_API_KEY` environment variable, which the MCP server process inherits from the environment that launches Claude Code. There is deliberately no in-product key option: one variable covers local development, CI, and UI installs.

- **Never** put the key in `.mcp.json`, source files, shell history, chat, or logs. Tool errors redact the active key before Claude sees them.

Claude Code does not start a plugin's MCP server while a required option is unset, so configure `api_key` before expecting the Querit tools to appear in `/mcp`.

See the [claude-code-querit README](./claude-code-querit/README.md) for the full tool reference and the safety limits.

## n8n-nodes-querit — n8n

An n8n community node with **Search Web** and **Fetch Content** operations, native paired-item and `Continue On Fail` handling, and AI-tool support.

Install `n8n-nodes-querit` through n8n's community-node interface, then create a **Querit API** credential and paste in the API key. n8n stores it as an encrypted credential; the node never writes it into workflow JSON or execution data. See the [n8n-nodes-querit README](./n8n-nodes-querit/README.md) for operation details and development instructions.

## zapier-querit — Zapier

A Zapier Platform CLI integration with one Search action, **Find Web Search Results**. Authentication is a masked custom API-key field, tested with a fixed one-result `POST /v1/search`.

The integration is not published to Zapier's app directory yet. Registration, the private test push, and public review all require the company-owned Zapier developer account; the [zapier-querit README](./zapier-querit/README.md) carries the full handoff checklist.

## browserbase-querit-demo — Browserbase

A reference demo, not an installable package: it searches with Querit, then opens the top result in a Browserbase cloud browser through Playwright `connectOverCDP` and saves a screenshot as evidence. It needs both `QUERIT_API_KEY` and `BROWSERBASE_API_KEY` in the environment and deliberately does not read a `.env` file. See the [browserbase-querit-demo README](./browserbase-querit-demo/README.md).

## Repository layout

Each directory is an independent npm package with its own version, CI, and
release cycle. There is no root workspace: the integrations have independent
dependency trees, so each package keeps its own `package.json`,
lockfile, and `node_modules`.

```text
querit-plugins/
├── .claude-plugin/            # Claude Code marketplace catalog
├── pi-querit/                 # Pi extension (TypeScript, no build step)
├── dsh-querit/                # DeepSeek Harness provider package (compiled lib/ committed)
├── opencode-querit/           # OpenCode plugin (compiled lib/ committed)
├── claude-code-querit/        # Claude Code plugin (installable payload in plugin/)
├── n8n-nodes-querit/          # n8n community node (compiled for publishing)
├── zapier-querit/             # Zapier CLI integration (not published)
└── browserbase-querit-demo/   # Browserbase reference demo (not published)
```

## Development

Work inside a package directory; the root has no scripts:

```bash
cd pi-querit && npm ci && npm run check && npm test
cd dsh-querit && npm ci && npm run check && npm run build && npm test
cd opencode-querit && npm ci && npm run check && npm run build && npm test
cd claude-code-querit && npm ci && npm run verify
cd n8n-nodes-querit && npm ci --ignore-scripts && npm run check && npm run lint && npm test && npm run build
cd zapier-querit && npm ci && npm run check && npm run build
cd browserbase-querit-demo && npm ci && npm run check && npm test && npm run build && npm run pack
```

The Claude Code marketplace catalog is validated separately from the repository root:

```bash
claude plugin validate . --strict
claude plugin validate ./claude-code-querit/plugin --strict
```

Publishing is per package. From that package's directory, run
`npm version <version> --no-git-tag-version` so `package.json` and
`package-lock.json` stay in sync, then verify and run `npm publish`. Releases
are tagged on GitHub with the package name prefix, e.g. `pi-querit@<version>`.

## License

MIT — see each package's LICENSE file.
