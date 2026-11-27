# Changelog

Recent updates across the repository, newest first. Full history for each
package is its git log.

## 2026-11-27

- **magpie** — no plugin of our own after all. A `magpie-querit` plugin
  (1.0.0, built on magpie's plugin `search` hook and published to a GitHub
  repository of its own) was written and then withdrawn the same day:
  Querit is already one of the search APIs of the third-party
  [`@guotree/magpie-websearch`](https://github.com/guotree/magpie-websearch)
  (`magpie-websearch:querit`), which lists "Querit" in
  **Settings › Models › Web search** beside its other APIs. The README now
  points magpie users there — `magpie plugin add @guotree/magpie-websearch`,
  then `magpie search add magpie-websearch:querit <key>` — and says what
  that channel sends: the query and magpie's result count only, with
  results cached for ten minutes by default. The withdrawn plugin's source
  stays at the tag `magpie-querit@1.0.0`.
- **dsh-querit 2.0.0** — moved to the dsh 0.2.2-rc.5 host seams. `engines.dsh`
  is now `>=0.2.2-rc.5 <0.3.0`, Node.js 24.9 is required as the host
  requires it, and dsh 0.1.x hosts should pin `dsh-querit@1.1.2`. The
  settings UI no longer has `ctx.settings.installSection` to register with:
  it is the row's own configuration page on the `plugins.row.config` slot
  (**Settings → Plugins → Installed → `dsh-querit` → the `web-search-querit`
  row → Configure**), where the API key and every search default are edited
  through `ctx.configForms` and a save reaches the next operation without a
  restart. Every config value is a live handle that an operation reads as it
  stands. The credentials service is now authoritative when installed, as it
  is for the host's own providers: a row `apiKey` wins, then the credentials
  store, and the launching environment only where no credentials service
  runs (it used to come first). Both providers declare a title and a
  localized description, report `ready` from the presence of a key, and give
  each result a model-facing `summary` (highlights, then body text) apart
  from the display `snippet`. The `./invariant` export is gone with the
  removed `@deepseek-ai/dsh-invariants`. Querit API: `count` up to 100 and
  left unset by default, plus `highlights`, `contentMaxChars`, `needMarkdown`,
  `rank` (dropped for the `code` vertical, which rejects it), `vertical`,
  `resourceTags`, and `russian`; the deprecated `chunksPerDoc` is sent only
  when set. HTTP 429/500/503 are retried with bounded backoff honoring
  `Retry-After`, failure messages end with `search_id`, and each operation
  logs its `search_id`, server time, and cost.
- **pi-querit 1.2.0** — type-checked and tested against Pi 1.6.1, and it now
  ships the `CHANGELOG.md` Pi reads on update. `web_search` and
  `fetch_content` declare `readOnlyHint` and `openWorldHint`, so a
  permission extension no longer assumes the MCP defaults and asks for
  confirmation on every search. Querit API: `web_search` takes an optional
  `vertical` (`code`, `finance`); `fetch_content` takes `max_chars`,
  `highlight_query`, and `highlight_max_chars`; `querit-search.json` gains
  `highlights`, `contentMaxChars`, `rank`, and `needMarkdown`. `count` now
  goes up to 100 and is left unset by default so Querit applies its server
  default (the extension used to ask for 5; set `"count": 5` in
  `/querit-setup` to keep that), and the deprecated `chunksPerDoc` is sent
  only when set. Results carry highlights and Markdown fields when requested,
  and the result line shows Querit's cost when it reports one. Truncated
  output goes to a per-user temp folder (`pi-querit-<uid>`, mode `0700`,
  files `0600`).
- **opencode-querit 3.0.0** — follows the current OpenCode v2 and Querit APIs.
  The host floor is OpenCode 2.0.28 (verified against 2.4.2; on an older v2
  host pin `opencode-querit@2.0.0`, on v1 `opencode-querit@1.0.2`), the first
  release that reports a rejected `web_fetch` call as a normal tool failure
  instead of crashing the call, and `zod` 4.2.0 or later is required — the
  first release whose schemas expose the JSON Schema hook OpenCode v2 uses to
  describe a plugin tool's input. `web_fetch` now forwards OpenCode's abort
  signal, so a stopped call cancels the request and any pending retry wait.
  Querit API: `count` goes up to 100 and is left unset by default so Querit
  applies its server default (the plugin used to ask for 5; set `"count": 5`
  to keep that), the deprecated `chunksPerDoc` is sent only when set (it used
  to go out as 1 on every request), and new options cover `highlights`,
  `includeContent` with `contentMaxChars`, `needMarkdown`, `vertical` with
  `resourceTags`, `rank` (dropped for the `code` vertical, which rejects it),
  and `russian` in `languages`. Results carry highlights and Markdown fields
  when requested, and `page_age` is read as the UTC time Querit reports it.
  HTTP 429/500/503 are retried at most twice with jittered backoff honoring
  `Retry-After`; the retry decision and every failure follow Querit's
  `error_code`, which is checked even on an HTTP 200, and failure messages
  end with `search_id`.
- **claude-code-querit 1.1.0** — follows the current Querit API. `web_search`
  gains `highlights`, `highlight_query`, `highlight_max_chars`, `need_content`,
  `max_chars`, `need_markdown`, `rank`, and `vertical`; `count` now goes up to
  100 and is omitted unless asked for, so Querit applies its server default
  (the tool used to ask for 5), and the deprecated `chunksPerDoc` and a fixed
  `needContent: false` are no longer sent. `fetch_content` gains `max_chars`,
  `highlight_query`, and `highlight_max_chars`. Results carry highlights and
  Markdown fields when requested, the header shows Querit's cost when it
  reports one, and `page_age` is labeled as the UTC time it is. HTTP
  429/500/503 are retried with bounded backoff honoring `Retry-After`; the
  retry decision and every failure follow Querit's `error_code`, which is
  checked even on an HTTP 200, and failure messages end with `search_id`.
  The research skill's `allowed-tools` names were stale, from before the
  plugin was renamed `querit-ai` (`mcp__plugin_querit_querit__*`), and the
  README's `/querit:research` is `/querit-ai:research`.
- **zapier-querit 1.1.0** — the Search action follows the current Querit API.
  Result Count goes up to 100 and is no longer forced to 5: it is sent only
  when a Zap sets it, so Querit applies its own default. New inputs: Custom
  Time Range (any `dN`/`wN`/`mN`/`yN` period or a
  `YYYY-MM-DDtoYYYY-MM-DD` range), Vertical with Resource Tags, Rank
  Preference (rejected with the code vertical), Content Max Characters, and
  Include Highlights with Max Highlight Characters; Languages gains Russian.
  Unset fields and off toggles are no longer sent, and the deprecated
  `chunksPerDoc` is sent only when set. Each result returns `highlights` and
  Querit's reported `cost` (six decimals; empty when unavailable). 429, 500,
  and 503 are retried at most twice with jittered backoff honoring
  `Retry-After` up to 5 s, decided by `error_code`, which is checked even on
  an HTTP 200; failure messages end with `search_id`, and a 429 that still
  fails raises Zapier's own `ThrottledError`. Still unpublished: registration
  and `zapier push` need the company Zapier account.

## 2026-09-20

- **dsh-querit 1.1.2** — peer ranges now accept dsh 0.1.5-rc and 0.1.6-alpha
  hosts. `^0.1.2-rc.1` rejected those prereleases under npm's same-tuple
  rule, so installing on current hosts printed peer warnings even though the
  seams this package uses (`ctx.web`, `installSection`, `remote.credentials`,
  `settings.plugin.item`) are unchanged since 0.1.2-rc.1. The 0.1.2-rc.1
  floor stays; on 0.1.0–0.1.1 hosts pin `dsh-querit@1.0.6`. DevDependencies
  track `@deepseek-ai/dsh-*@0.1.5-rc.2` (npm `latest`).

## 2026-09-15

- **opencode-querit 2.0.0** — rebuilt for OpenCode v2 (requires opencode ≥
  2.0.3; v1 hosts pin `opencode-querit@1.0.2`). The plugin now registers
  Querit as a websearch provider (`ctx.websearch.transform`) that powers the
  built-in `websearch` tool directly — no `OPENCODE_ENABLE_EXA`/
  `OPENCODE_ENABLE_PARALLEL` flags or Exa/Parallel/Tavily credentials needed —
  instead of shadowing it with a custom `web_search` tool. On the first
  search OpenCode offers Querit in its native provider form, or users pin it
  via config `websearch: { "provider": "querit" }`; an explicit
  `setDefault: true` option forces it at startup (off by default so the plugin
  never overrides the user's persisted provider choice). `web_fetch` remains
  a custom tool (zod schema, v2 tool registry) backed by `/v1/contents`.
  Plugin options moved from the v1 tuple form to
  `"plugins": [{ "package": "opencode-querit", "options": { ... } }]`.
  `@opencode/plugin` is now a type-only optional peer dependency (zod is the
  only runtime dependency), and the local "no API key" tests no longer pick
  up a developer-machine `QUERIT_API_KEY`.

## 2026-09-08

- **dsh-querit 1.1.1** — the settings card outline now uses the design system's
  surface token (`.5px solid var(--dsw-alias-border-l4)`, radius 16px) exactly
  as every dsh card does, instead of the divider token (`border-l2`, 10%
  alpha at 1px), which left the Querit row looking like it had no border
  beside the official cards. The card's text inputs take the same surface
  outline; `border-l2` stays on the internal separators and the discard
  button, where dsh uses it too.
- **dsh-querit 1.1.0** — migrated to the dsh 0.1.2 host seams: the settings
  namespace now registers through `ctx.settings.installSection` (the
  `installSettingsSection`/`settingsNamespace` helpers were removed upstream),
  and the settings card reads and writes the API key via `remote.credentials`
  with the new describe/set shapes and the `credentials/reference-updated`
  event. The provider id changed `querit` → `web-search-querit` (matching the
  native `web-search-deepseek` naming; seam configs now read
  `searchProvider: web-search-querit`), and `fetch` now defaults to `false`
  because the 0.1.2 base composition and agent presets register `web_fetch`
  themselves through `tool-web` (both web tools route through the seam, hence
  Querit). Peer ranges bumped to `^0.1.2-rc.1`; on older dsh hosts pin
  `dsh-querit@1.0.6`.

## 2026-09-04

- **pi-querit 1.1.2** — load the extension from the package root (`index.ts`)
  instead of `src/`, so Pi lists it as `pi-querit` rather than `pi-querit:src`.

## 2026-09-02

- **pi-querit 1.1.1** — dropped the per-response "untrusted web data"
  disclaimer from `web_search` and `fetch_content` output; page-content
  markers simplified to `BEGIN/END PAGE CONTENT`.
- **Repository** — npm publishing is automated: pushing a version bump to
  `main` publishes `dsh-querit`, `opencode-querit`, and `pi-querit` to npm
  with provenance via trusted publishing (no NPM_TOKEN); pushes without a
  version bump are skipped. `n8n-nodes-querit` keeps its tag-triggered flow.
  The new-plugin convention is recorded in `AGENTS.md`.

## 2026-09-01

- **zapier-querit 1.0.2** — added the auth connection label and stopped
  cleaning Zapier-managed input fields.
- **Docs** — documented the upstream Oh My Pi built-in Querit provider.

## 2026-08-29

- **dsh-querit 1.0.6** — settings card chrome aligned with the official
  PluginCard, adapting to light and dark palettes.

## 2026-08-27

- **pi-querit 1.1.0** — temp output files are cleaned up on exit; the
  fixed-model summary workflow was dropped.

## 2026-08-24

- **n8n-nodes-querit 0.1.1** — released.
- **zapier-querit 1.0.1** — linked the Zapier integration app (App244284).
- **claude-code-querit** — renamed the plugin to `querit-ai`; auth reads
  `QUERIT_API_KEY` only, and the `api_key` userConfig option was removed.

## 2026-08-23

- **zapier-querit** — initial Zapier Platform CLI integration with the
  Find Web Search Results action.
- **browserbase-querit-demo** — initial reference demo: Querit search, then
  the top result opened in a Browserbase cloud browser for a screenshot.

## 2026-08-18 – 2026-08-22

- **dsh-querit 1.0.3 / 1.0.4** — shipped as a self-wiring profile bundle;
  added the settings card and auto-disable for the DeepSeek search provider.
- **Repository** — removed localized READMEs and bumped packages for the
  public release.

Earlier history — the initial releases of `pi-querit`, `opencode-querit`,
`claude-code-querit`, and `n8n-nodes-querit` — is in the git log.
