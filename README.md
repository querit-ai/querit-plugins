# querit-plugins

Official [Querit](https://www.querit.ai) search plugins for AI agent harnesses.

[Querit](https://www.querit.ai) delivers real-time, authoritative web search results and clean page content for LLM applications. Each plugin in this repository wires one agent harness to the Querit API (`/v1/search` + `/v1/contents`) so your agent can search the live web and fetch pages — with cited sources, domain/region/language/time-range filters, and output that is always treated as untrusted web data.

| Harness | Package | Install |
| --- | --- | --- |
| [Pi](https://github.com/earendil-works/pi) | `pi-querit` | `pi install npm:pi-querit` |
| [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/cordis) | `dsh-querit` | `dsh plugin --profile web add dsh-querit` |
| [OpenCode](https://opencode.ai) | `opencode-querit` | `"plugin": ["opencode-querit"]` |

How each plugin reads the API key and search defaults is covered in its own section below.

## Get an API key

Sign up on [Querit.ai](https://www.querit.ai) to get an API key with **1,000 free API calls per month** — no credit card required. The same key works for all three plugins.

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

## Repository layout

Each directory is an independent npm package with its own version, CI, and
release cycle. There is no root workspace: the three harnesses have entirely
different dependency trees, so each package keeps its own `package.json`,
lockfile, and `node_modules`.

```text
querit-plugins/
├── pi-querit/      # Pi extension (TypeScript, no build step)
├── dsh-querit/     # DeepSeek Harness provider package (compiled lib/ committed)
└── opencode-querit # OpenCode plugin (compiled lib/ committed)
```

## Development

Work inside a package directory; the root has no scripts:

```bash
cd pi-querit && npm ci && npm run check && npm test
cd dsh-querit && npm ci && npm run check && npm run build && npm test
cd opencode-querit && npm ci && npm run check && npm run build && npm test
```

Publishing is per package. From that package's directory, run
`npm version <version> --no-git-tag-version` so `package.json` and
`package-lock.json` stay in sync, then verify and run `npm publish`. Releases
are tagged on GitHub with the package name prefix, e.g. `pi-querit@<version>`.

## License

MIT — see each package's LICENSE file.
