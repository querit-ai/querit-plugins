# querit-plugins

Official [Querit](https://www.querit.ai) search integrations for automation and AI agent platforms.

[Querit](https://www.querit.ai) delivers real-time, authoritative web search results and clean page content for LLM applications. Each integration in this repository connects one platform to the Querit API (`/v1/search` + `/v1/contents`) for live web search and page fetching — with cited sources, domain/region/language/time-range filters, and output that is always treated as untrusted web data. magpie has no plugin of its own here: Querit is one of the search APIs of the third-party [`@guotree/magpie-websearch`](https://github.com/guotree/magpie-websearch), which covers search only because magpie's plugin hook has no page-fetching side.

| Platform | Package | Install |
| --- | --- | --- |
| [Pi](https://github.com/earendil-works/pi) | `pi-querit` | `pi install npm:pi-querit` |
| [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/cordis) | `dsh-querit` | `dsh plugin --profile web add dsh-querit` |
| [OpenCode](https://opencode.ai) | `opencode-querit` | `"plugins": ["opencode-querit"]` |
| [magpie](https://github.com/yetone/magpie) | [`@guotree/magpie-websearch`](https://github.com/guotree/magpie-websearch) (third-party) | `magpie plugin add @guotree/magpie-websearch` |
| [Claude Code](https://code.claude.com/docs/en/plugins) | `claude-code-querit` | `/plugin marketplace add querit-ai/querit-plugins` |

Four more are not generally available yet — three live in this repository, and the Oh My Pi provider is an upstream change rather than a package here:

| Platform | Directory | Status |
| --- | --- | --- |
| [Zapier](https://zapier.com) | `zapier-querit/` | Complete and locally validated; awaiting registration and Zapier public review |
| [Browserbase](https://www.browserbase.com) | `browserbase-querit-demo/` | Reference demo, not a published package |
| [n8n](https://n8n.io) | `n8n-nodes-querit/` | Temporarily not integrated: version 0.1.1 is on npm, but it predates the current Querit API and was not part of the 2026-11-27 update |
| [Oh My Pi (OMP)](https://omp.sh) | — | Built-in Querit provider from an upstream change; available after that PR is merged |

How each integration reads the API key and search defaults is covered in its own section below; the magpie section covers a third-party plugin. Recent updates are summarized in [CHANGES.md](./CHANGES.md).

## Get an API key

Sign up on [Querit.ai](https://www.querit.ai) to get an API key with **1,000 free API calls per month** — no credit card required. The same key works for all integrations.

## pi-querit — Pi

A Pi extension that registers `web_search` and `fetch_content` as first-class tools. Your agent calls them automatically whenever an answer needs the live web.

**Install**

```bash
pi install npm:pi-querit
```

Type-checked and tested against Pi 1.6.1. Nothing in the extension needs a newer runtime API, so older Pi versions keep working.

**API key**

Run the interactive setup wizard inside Pi once:

```text
/querit-setup
```

The wizard validates the key, then lets you configure persistent search defaults (result count, time range, countries, languages, domain whitelist/blacklist). Everything except the API key can be skipped.

- **Where the key lives:** `~/.pi/agent/querit-search.json` (respects `PI_CODING_AGENT_DIR`), written with mode `0600` on POSIX.
- **CI / ephemeral alternative:** set the `QUERIT_API_KEY` environment variable. The environment variable takes precedence when both are present.
- **Never put the key in chat or logs:** the extension masks key input and redacts the key from every error surface.

See the [pi-querit README](./pi-querit/README.md) for the full tool reference.

## dsh-querit — DeepSeek Harness

A provider package for the DeepSeek Harness `ctx.web` capability seam. It does not register the model-facing `web_search` tool; the agent preset does. Both `web_search` and `web_fetch` route through Querit-backed providers.

**Install**

```bash
dsh plugin --profile web add dsh-querit
```

The package ships as a profile bundle: installing it adds the `web-search-querit` provider row, routes the seam to it, and disables the DeepSeek search row, so no `cordis.patch.yml` edits are needed. It requires dsh 0.2.2-rc.5 or a later 0.2.x host on Node.js 24.9 or newer; on dsh 0.1.x hosts install `dsh-querit@1.1.2`.

**API key** — resolved per operation in priority order:

1. `apiKey` on the `web-search-querit` row, when set,
2. the credentials store entry named by `apiKeyEnv` (`QUERIT_API_KEY`) — the installed credentials service is authoritative, including the absence of a key, or
3. only where no credentials service runs (a headless profile, for instance): `QUERIT_API_KEY` from the launching environment.

The key is normally entered on the plugin's settings page — **Settings → Plugins → Installed → `dsh-querit` → the `web-search-querit` row → Configure** — which writes it to the credentials store. The same page edits the search defaults (`count`, `timeRange`, `countries`, `languages`, domain lists, `highlights`, `vertical`, fetch format and limits), and saves apply to the next operation without a restart.

See the [dsh-querit README](./dsh-querit/README.md) for the full config table.

## opencode-querit — OpenCode

An OpenCode v2 plugin (OpenCode ≥ 2.0.28, verified against 2.4.2) that registers **Querit as a websearch provider** — powering the built-in `websearch` tool — plus a `web_fetch` custom tool backed by Querit's crawler. On OpenCode v1 pin `opencode-querit@1.0.2`; on a v2 host older than 2.0.28 pin `opencode-querit@2.0.0`.

**Install**

Add the plugin to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-querit"]
}
```

Then restart OpenCode. On the first `websearch` call pick Querit in OpenCode's provider form, or pin it once with `"websearch": { "provider": "querit" }`.

**API key** — resolved per call in priority order:

1. `QUERIT_API_KEY` environment variable (default; rename via `apiKeyEnv`), or
2. `apiKey` in the plugin options (least preferred — secrets should not live in config files):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "opencode-querit", "options": { "count": 8, "timeRange": "m3", "languages": ["english"] } }
  ]
}
```

Search defaults and fetch behavior are configured the same way (`count`, `timeRange`, `countries`, `languages`, `includeDomains`, `excludeDomains`, `vertical`, `resourceTags`, `rank`, `highlights`, `includeContent`, `contentMaxChars`, `needMarkdown`, `chunksPerDoc`, `fetchFormat`, `fetchCrawlTimeout`, `fetchMaxChars`, `maxOutputChars`). An option left unset is left out of the request, so Querit's own defaults apply (`count` included).

See the [opencode-querit README](./opencode-querit/README.md) for the full config table and local-testing instructions.

## magpie — magpie-websearch

Querit comes to [magpie](https://github.com/yetone/magpie) through [`@guotree/magpie-websearch`](https://github.com/guotree/magpie-websearch), a third-party plugin that adds many search APIs to magpie's own web search, Querit among them. **Settings › Models › Web search** lists "Querit (magpie-websearch)" beside its other APIs: magpie keeps the API keys, the order of the APIs, and the request log, and every agent it serves gets the results through its built-in `web_search`. The plugin is MIT-licensed and maintained by its author, not by Querit; report problems with it in its own repository.

**Install**

```bash
magpie plugin add @guotree/magpie-websearch
magpie search add magpie-websearch:querit <your-api-key>
```

In the app: **Settings › Models › Web search** → add Querit, paste the key, and drag it to where it belongs in the order.

The plugin registers all of its search APIs at once. To register only Querit:

```bash
magpie plugin options magpie-websearch '{"enable": ["querit"]}'
```

**What its Querit API does** (as of `@guotree/magpie-websearch` 0.7.3)

- Each search is one `POST https://api.querit.ai/v1/search` with the query and magpie's result count (1–20). Results become pages with their title, URL, snippet, and age.
- Results are cached for ten minutes, and a cached answer costs no API call. For "latest" questions turn that off, together with `enable` if you use it:

  ```bash
  magpie plugin options magpie-websearch '{"enable": ["querit"], "querit": {"cacheTTL": 0}}'
  ```

- It sends nothing but the query and the count, so Querit's time range, vertical, highlights, and body text cannot be asked for through it; those need the Querit API itself.
- Querit is billed per search.

The plugin adds search APIs only, with no page-fetching channel of its own, so page fetching stays with magpie. See the [magpie-websearch README](https://github.com/guotree/magpie-websearch/blob/main/README.en.md) for every option.

## claude-code-querit — Claude Code

A Claude Code plugin that bundles a stdio MCP server exposing `web_search` and `fetch_content`, plus a `/querit-ai:research` skill for source-grounded answers with citations.

**Install**

```text
/plugin marketplace add querit-ai/querit-plugins
/plugin install querit-ai@querit
```

**API key** — the plugin reads only the `QUERIT_API_KEY` environment variable, which the MCP server process inherits from the environment that launches Claude Code. There is deliberately no in-product key option: one variable covers local development, CI, and UI installs.

- **Never** put the key in `.mcp.json`, source files, shell history, chat, or logs. Tool errors redact the active key before Claude sees them.

The MCP server starts without the variable; a `web_search` or `fetch_content` call then fails with "Querit is not configured." until it is set.

See the [claude-code-querit README](./claude-code-querit/README.md) for the full tool reference and the safety limits.

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

Work inside a package directory; the root has no scripts. After `npm ci`, run that package's gates:

| Package | Gates |
| --- | --- |
| `pi-querit/` | `npm run check && npm test` |
| `dsh-querit/` | `npm run check && npm run build && npm test` |
| `opencode-querit/` | `npm run check && npm run build && npm test` |
| `claude-code-querit/` | `npm run verify` |
| `n8n-nodes-querit/` | install with `npm ci --ignore-scripts`, then `npm run check && npm run lint && npm test && npm run build` |
| `zapier-querit/` | `npm run check && npm run build` |
| `browserbase-querit-demo/` | `npm run check && npm test && npm run build` |

Every npm package runs its gates automatically on publish (`prepack`), so manual runs matter only while developing. The Claude Code marketplace catalog is validated separately from the repository root:

```bash
claude plugin validate . --strict
claude plugin validate ./claude-code-querit/plugin --strict
```

Publishing is per package. `dsh-querit`, `opencode-querit`, and
`pi-querit` publish automatically: run `npm version <version> --no-git-tag-version` in the
package directory (so `package.json` and `package-lock.json` stay in sync),
commit, and push to `main`. The per-package publish workflow skips pushes
whose version is already on npm and otherwise runs the package gates and
publishes with npm provenance. `n8n-nodes-querit` keeps its tag-triggered
flow: push an `n8n-nodes-querit@<version>` tag. All these workflows publish
through npm trusted publishing (OIDC, no NPM_TOKEN); each package needs a
one-time GitHub Actions trusted-publisher entry in its npm settings pointing
at its workflow file.

## License

MIT — see each package's LICENSE file.
