# Changelog

Recent updates across the repository, newest first. Full history for each
package is its git log.

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
