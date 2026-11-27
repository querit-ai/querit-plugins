# magpie-querit

[![npm version](https://img.shields.io/npm/v/magpie-querit?color=blue)](https://www.npmjs.com/package/magpie-querit)
[![license](https://img.shields.io/badge/license-MIT-yellow.svg)](./LICENSE)

Adds [Querit](https://www.querit.ai) to [magpie](https://github.com/yetone/magpie)'s built-in web search. **Settings › Models › Web search** lists a "Querit" API beside Tavily, Brave, Exa, and the rest: magpie keeps the API keys, the order of the APIs, and the request log, and asks Querit for one search at a time. Every agent magpie serves gets the results through magpie's own `web_search`, with no agent-side configuration.

Sign up on [Querit.ai](https://www.querit.ai) to get an API key with **1,000 free API calls per month** — no credit card required.

## Quick start

```sh
magpie plugin add magpie-querit
magpie search add magpie-querit:querit <your-api-key>
magpie tool web_search "what changed in the Rust 2024 edition" --count 5
```

In the app: **Plugins › Add a plugin** → enter `magpie-querit` → **Install**. Then **Settings › Models › Web search** → add Querit, paste the key, and drag it to where it belongs in the order.

Requires magpie v0.1.2887 or newer, which introduced the plugin `search` hook this package uses.

## How it works

- It registers one search API, `querit`, which magpie lists as `magpie-querit:querit`. That full form is the one to use in commands.
- Each search is one `POST https://api.querit.ai/v1/search` with the query and magpie's result count (1–20). Results become pages with their title, URL, snippet, and age.
- magpie gives a search API a quarter of a search's time limit, 30 seconds. The plugin stops at 25 so that a slow Querit is reported as a failure instead of a timeout.
- Querit is billed per search. A cost reported by Querit is not shown, because the hook returns only pages.

Several keys can be given, separated by commas. magpie tries them in turn and rests one that Querit refuses (HTTP 401, 402, 403, or 429, with `Retry-After` honored). Any other failure, such as an invalid request or Querit being down, makes magpie ask the next search API in the order. HTTP 500 and 503 are retried once before that. Failure messages end with Querit's `search_id`, which its support team uses to trace a request.

magpie clips each page's text to 1500 bytes. With the `highlights` option on, the text starts with the passages Querit selected against the query, followed by the snippet, so the most relevant material survives the cut.

### What the hook cannot pass

The hook receives a query, a count, a key, and nothing else. Site, country, and language filters, a per-query time range, and Querit's code and finance verticals cannot be chosen per search. The plugin options below cover the cases where one setting for every search is enough. magpie's `web_fetch` is its own and is not pluggable, so page fetching does not go through Querit.

## Options

Options apply to every search the plugin makes.

| Option | Values | Default | Meaning |
|---|---|---|---|
| `timeRange` | `d7`, `w2`, `m3`, `y1`, any `dN`/`wN`/`mN`/`yN`, or `YYYY-MM-DDtoYYYY-MM-DD` | none | Restrict results to a time window. Querit's docs call a missing time filter the most common cause of poor answers to "latest" questions. |
| `vertical` | `code`, `finance` | none | Route every search to a vertical data source. A mismatched vertical loses results, so set it only where nothing but code or finance questions are asked. |
| `highlights` | `true`, `false` | `false` | Ask Querit for the passages of each page that match the query. Querit bills body text per page. |
| `baseUrl` | an `https://` URL | `https://api.querit.ai` | Querit API base, for a proxy or a self-hosted gateway. |

```sh
magpie plugin options magpie-querit '{"timeRange": "d7", "vertical": "", "highlights": false}'
magpie plugin options magpie-querit off    # resets every option
```

Set them in the app through the plugin's **Options** button in **Plugins › Installed**. A change reaches the next search without a restart. An option with a missing or invalid value is left unset.

## Development

The package has no dependencies and no build step: magpie installs plugins with Bun and does not run their install scripts, so what is published is what runs. Requires Node.js 20.3 or newer.

```bash
npm install
npm run check     # syntax
npm test          # node --test: request shape, error mapping, retries, sanitizing
npm run pack:check
```

`src/querit.mjs` holds the search API; `index.mjs` is the entry magpie calls. magpie calls every exported function of an entry as a plugin, so the entry exports exactly one.

## License

MIT
