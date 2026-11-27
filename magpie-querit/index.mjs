import { createQueritSearchApi } from "./src/querit.mjs"

/**
 * magpie calls every exported function as a plugin; keep this the only one.
 *
 * The `search` hook adds a Querit API to Settings › Models › Web search, beside
 * Tavily, Brave, and the rest: magpie keeps the keys, the order, and the
 * request log, and asks this API for one search at a time. It is magpie's own
 * hook; OpenCode ignores it.
 *
 * @param input - magpie's plugin input; unused.
 * @param {object} options - the entry's options, as set in magpie or with
 *   `magpie plugin options magpie-querit '<json>'`. See src/querit.mjs.
 * @returns {Promise<{ search: Record<string, object> }>} The hooks this plugin gives.
 */
export const QueritSearch = async (_input, options = {}) => ({
  search: { querit: createQueritSearchApi(options) },
})
