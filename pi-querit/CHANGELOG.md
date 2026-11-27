# Changelog

## 1.2.0 - 2026-11-27

Pi reads this file when the package updates. Dates are YYYY-MM-DD.

### Pi

- Type-checked and tested against Pi 1.6.1 (previously 0.83.0). Works on
  older Pi versions too: nothing here needs a newer runtime API.
- `web_search` and `fetch_content` now declare `readOnlyHint` and
  `openWorldHint`. Without them, a permission extension assumes the MCP
  defaults and may ask for confirmation on every search.
- Truncated output goes to `pi-querit-<uid>` in the OS temp folder, one
  directory per user, with mode `0700`; files are mode `0600`. Leftovers in
  the old shared `pi-querit` folder are still cleaned up.

### Querit API (per the reference updated 2026-11-24)

- `web_search` takes an optional `vertical`: `"code"` for programming
  questions, `"finance"` for markets and companies. A configured `rank` is
  dropped for code searches, which the API rejects with `rank`.
- New defaults in `querit-search.json`: `highlights`, `contentMaxChars`,
  `rank`, and `needMarkdown` (Enterprise). See the README's advanced options.
- `fetch_content` takes `max_chars`, `highlight_query`, and
  `highlight_max_chars`.
- `count` now goes up to 100 and is left unset by default, so Querit applies
  its own server default. Before, the extension always asked for 5. To keep
  that behavior, set `"count": 5` in `/querit-setup`.
- `chunksPerDoc` is deprecated by Querit and is no longer sent unless your
  configuration sets it. Switch to `highlights`.
- Results carry highlights and Markdown fields when requested, and the
  result line shows Querit's per-request cost when it reports one.
- `russian` is accepted as a language.
- HTTP 429, 500, and 503 are retried with bounded backoff and honor
  `Retry-After`; 400, 401, 403, and 404 are never retried. Failure messages
  end with the request's `search_id`, which Querit support asks for.
