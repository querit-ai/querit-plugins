# Changelog

## 1.1.0

Brings `search/web_search` up to date with Querit's current search reference and adds bounded retries.

1. Raise the Result Count limit from 20 to 100 and stop forcing a default of 5; the count is sent only when a Zap sets it, so Querit applies its own default.
2. Add Russian to Languages.
3. Add Include Highlights and Max Highlight Characters (sent as `highlights`) and return the `highlights` fragments with each result.
4. Add Vertical (Code or Finance) with its Resource Tags, plus Rank Preference and Content Max Characters.
5. Add Custom Time Range for any relative period (`d30`, `w6`, `m2`, `y3`) or an exact date range (`2026-01-01to2026-03-31`); Time Range keeps its four presets.
6. Return Querit's reported `cost` with six decimals on each result; leave it empty when unavailable rather than reporting zero.
7. Retry 429, 500, and 503 at most twice with jittered backoff, honoring `Retry-After` up to 5 seconds. The decision follows Querit's `error_code`, which is checked even on an HTTP 200; other codes and network failures are never retried.
8. End API failure messages with the request's `search_id`, state the attempt count after retries, and keep raising `ThrottledError` (the platform's default for a 429) with the `Retry-After` delay when a 429 still fails.
9. Mark Content Chunks per Result as deprecated by Querit; it remains sent only when a Zap sets it.

## 1.0.2

Clears the remaining Zapier publishing review warnings.

1. Add a connection label so the "Connect an Account" step shows a stable account name.
2. Disable platform input cleaning on search/web_search; the action already validates and normalizes its own input.

## 1.0.1

First production release of the Querit integration.

1. Update search/web_search to run on zapier-platform-core 19.1.0.

## 1.0.0

Initial private release with the Find Web Search Results action.
