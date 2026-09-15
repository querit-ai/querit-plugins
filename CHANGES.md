# Changelog

Recent updates across the repository, newest first. Full history for each
package is its git log.

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
