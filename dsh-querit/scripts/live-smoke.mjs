// Live smoke test for the built package: run with the workspace built and
// resolution rooted at it (`node scripts/live-smoke.mjs`), or from an installed
// profile directory to exercise profile resolution. The API key is read from
// QUERIT_API_KEY, or from the pi-querit config file when present; it is
// never printed.
const { QueritSearchProvider, QueritFetchProvider, Config } = await import('dsh-querit')
const { readFileSync } = await import('node:fs')
const piConfig = process.env.USERPROFILE + '/.pi/agent/querit-search.json'
let key = process.env.QUERIT_API_KEY?.trim()
if (!key) {
  try {
    key = JSON.parse(readFileSync(piConfig, 'utf8')).apiKey
  } catch {
    console.error('No QUERIT_API_KEY and no pi-querit config found; aborting.')
    process.exit(1)
  }
}
const options = {
  apiKey: key,
  baseURL: 'https://api.querit.ai',
  timeoutMs: 70000,
  count: 10,
  timeRange: 'y1',
  countries: [], languages: [],
  includeDomains: [],
  excludeDomains: ['pinterest.com', 'facebook.com', 'instagram.com', 'tiktok.com'],
  includeContent: false,
  chunksPerDoc: 1,
  fetchFormat: 'markdown',
  fetchCrawlTimeout: 10,
  fetchMaxChars: 8000,
}
const search = new QueritSearchProvider(() => options)
console.log('search provider available:', search.available())
const r = await search.search({ query: 'deepseek harness coding agent', maxResults: 3 })
console.log('search sources:', r.sources.length, '| truncated:', r.truncated, '| content:', r.content)
for (const s of r.sources.slice(0, 3)) {
  console.log('  - title:', s.title)
  console.log('    url:', s.url)
  console.log('    snippet chars:', (s.snippet || '').length, '| publishedAt:', s.publishedAt)
}
const fetchp = new QueritFetchProvider(() => options)
const f = await fetchp.fetch({ url: 'https://en.wikipedia.org/wiki/Web_search_engine' })
console.log('fetch:', f.statusCode, '| kind:', f.body.kind, '| chars:', f.body.content.length, '| truncated:', f.truncated)
console.log('fetch head:', f.body.content.slice(0, 60).replace(/\n/g, ' '))
const rowConfig = Config({ apiKeyEnv: 'QUERIT_API_KEY', count: 10, chunksPerDoc: 1, timeRange: 'y1', excludeDomains: ['pinterest.com', 'facebook.com', 'instagram.com', 'tiktok.com'] })
console.log('profile row config validates; fetch tool flag:', rowConfig.fetch, '| timeoutMs:', rowConfig.fetchTimeoutMs)
