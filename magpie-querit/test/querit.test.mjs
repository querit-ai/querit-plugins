import assert from "node:assert/strict"
import { test } from "node:test"

import { QueritSearch } from "../index.mjs"
import { createQueritSearchApi } from "../src/querit.mjs"

/** An id magpie accepts for a search API. */
const SEARCH_ID = /^[a-z0-9][a-z0-9-]{0,31}$/

const KEY = "qk-test-secret"
/** The documented endpoint; asserted literally, not read back from the plugin. */
const SEARCH_ENDPOINT = "https://api.querit.ai/v1/search"

/** One queued response per request; a Response body can be read once. */
function fetchQueue(...responses) {
  const queue = [...responses]
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    const response = queue.shift()
    if (!response) throw new Error("the test ran out of queued responses")
    return typeof response === "function" ? response() : response
  }
  return { fetchImpl, calls }
}

const json = (body, init = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  })

const success = (result = []) =>
  json({ error_code: 200, search_id: 9007199254740993123, results: { result } })

/** Never wait, and record that a wait was asked for. */
function instantSleep() {
  const waits = []
  const sleep = async (ms) => {
    waits.push(ms)
  }
  return { sleep, waits }
}

function api(options, responses) {
  const { fetchImpl, calls } = fetchQueue(...responses)
  const { sleep, waits } = instantSleep()
  return { calls, waits, entry: createQueritSearchApi(options, { fetchImpl, sleep }) }
}

test("the plugin entry gives one search API in the shape magpie lists", async () => {
  const hooks = await QueritSearch({}, {})
  assert.deepEqual(Object.keys(hooks), ["search"])
  const [id, entry] = Object.entries(hooks.search)[0]
  assert.match(id, SEARCH_ID)
  assert.equal(entry.name, "Querit")
  assert.match(entry.keysURL, /^https?:\/\//)
  assert.equal(typeof entry.execute, "function")
})

test("posts the documented request and maps results to pages", async () => {
  const { calls, entry } = api({}, [success([
    { title: "Page", url: "https://example.com/a", snippet: "intro", page_age: "2d", site_name: "Ex" },
    { title: "Duplicate", url: "https://example.com/a", snippet: "again" },
    { title: "Ftp", url: "ftp://example.com/b", snippet: "dropped" },
    { title: "Not a URL", url: "not a url", snippet: "dropped too" },
    null,
  ])])

  const pages = await entry.execute({ query: "hybrid search", count: 6, key: KEY }, { abort: new AbortController().signal })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, SEARCH_ENDPOINT)
  assert.equal(calls[0].init.method, "POST")
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`)
  assert.match(calls[0].init.headers["User-Agent"], /^magpie-querit\/\d+\.\d+\.\d+/)
  // Nothing chosen is nothing sent: Querit applies its own default count.
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: "hybrid search", count: 6 })

  assert.deepEqual(pages, [
    { title: "Page", url: "https://example.com/a", text: "intro", age: "2d" },
  ])
})

test("clamps count to the API range and omits one magpie did not choose", async () => {
  const { calls, entry } = api({}, [success(), success()])

  await entry.execute({ query: "q", count: 500, key: KEY }, {})
  await entry.execute({ query: "q", count: undefined, key: `  ${KEY}  ` }, {})

  assert.deepEqual(JSON.parse(calls[0].init.body), { query: "q", count: 100 })
  assert.deepEqual(JSON.parse(calls[1].init.body), { query: "q" })
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${KEY}`)
})

test("leads the text with highlights when they are asked for and returned", async () => {
  const { calls, entry } = api({ highlights: true }, [success([
    { title: "Page", url: "https://example.com/a", snippet: "intro", highlights: ["the relevant bit", "another"] },
    { title: "None", url: "https://example.com/b", snippet: "only a snippet" },
  ])])

  const pages = await entry.execute({ query: "q", count: 5, key: KEY }, {})

  assert.deepEqual(JSON.parse(calls[0].init.body), { query: "q", count: 5, highlights: true })
  assert.equal(pages[0].text, "the relevant bit\nanother\nintro")
  assert.equal(pages[1].text, "only a snippet")
})

test("sends the time range and vertical the options name, and ignores invalid ones", async () => {
  const { calls, entry } = api({ timeRange: " d7 ", vertical: "code" }, [success()])

  await entry.execute({ query: "asyncio semaphore", count: 5, key: KEY }, {})

  assert.deepEqual(JSON.parse(calls[0].init.body), {
    query: "asyncio semaphore",
    count: 5,
    filters: { timeRange: { date: "d7" }, vertical: "code" },
  })

  const { calls: ignored, entry: lenient } = api({ timeRange: "last week", vertical: "legal", highlights: "yes" }, [success()])
  await lenient.execute({ query: "q", count: 5, key: KEY }, {})
  assert.deepEqual(JSON.parse(ignored[0].init.body), { query: "q", count: 5 })
})

test("honors a custom base URL", async () => {
  const { calls, entry } = api({ baseUrl: "https://proxy.example/" }, [success()])

  await entry.execute({ query: "q", count: 5, key: KEY }, {})

  assert.equal(calls[0].url, "https://proxy.example/v1/search")
})

test("throws a refusal, with its status, when Querit rejects the key", async () => {
  for (const status of [401, 402, 403, 429]) {
    const { calls, entry } = api({}, [
      json({ error_code: status, error_msg: `key ${KEY} rejected`, search_id: 7 }, { status }),
    ])

    const error = await entry.execute({ query: "q", count: 5, key: KEY }, {}).then(
      () => assert.fail("expected a refusal"),
      (caught) => caught,
    )

    // magpie rests the key for a throw with an integer status, and only for that.
    assert.equal(error.status, status)
    assert.equal(error.message, `key [REDACTED] rejected [search_id: 7]`)
    assert.equal(calls.length, 1)
  }
})

test("reads a refusal out of an error_code on an HTTP 200, and Retry-After in both forms", async () => {
  const { entry } = api({}, [
    json({ error_code: 403, error_msg: "no Search API access", search_id: 9 }),
    json({ error_code: 429, error_msg: "slow down", search_id: 11 }, { status: 429, headers: { "retry-after": "30" } }),
    json({ error_code: 429, error_msg: "slow down", search_id: 12 }, {
      status: 429,
      headers: { "retry-after": new Date(Date.now() + 4_000).toUTCString() },
    }),
  ])

  const first = await entry.execute({ query: "q", count: 5, key: KEY }, {}).catch((error) => error)
  assert.equal(first.status, 403)
  assert.equal(first.retryAfter, undefined)
  assert.equal(first.message, "no Search API access [search_id: 9]")

  const seconds = await entry.execute({ query: "q", count: 5, key: KEY }, {}).catch((error) => error)
  assert.equal(seconds.status, 429)
  assert.equal(seconds.retryAfter, 30)

  const date = await entry.execute({ query: "q", count: 5, key: KEY }, {}).catch((error) => error)
  assert.equal(date.retryAfter, 4)
})

test("retries 500 and 503 once, then reports a plain failure that carries no status", async () => {
  const retryable = api({}, [json({ error_code: 500, error_msg: "boom", search_id: 5 }, { status: 500 }), success([{ url: "https://example.com/" }])])
  const pages = await retryable.entry.execute({ query: "q", count: 5, key: KEY }, {})
  assert.deepEqual(pages, [{ title: "https://example.com/", url: "https://example.com/", text: "" }])
  assert.equal(retryable.calls.length, 2)
  assert.deepEqual(retryable.waits, [400])

  const exhausted = api({}, [
    json({ error_code: 503, error_msg: "unavailable", search_id: 6 }, { status: 503 }),
    json({ error_code: 503, error_msg: "unavailable", search_id: 6 }, { status: 503 }),
  ])
  const error = await exhausted.entry.execute({ query: "q", count: 5, key: KEY }, {}).then(
    () => assert.fail("expected a failure"),
    (caught) => caught,
  )
  assert.equal(error.status, undefined)
  assert.equal(error.message, "unavailable [search_id: 6]")
  assert.equal(exhausted.calls.length, 2)
})

test("never retries 400, 404, a network failure, or malformed payload", async () => {
  const badRequest = api({}, [json({ error_code: 400, error_msg: "bad parameter", search_id: 3 }, { status: 400 })])
  const first = await badRequest.entry.execute({ query: "q", count: 5, key: KEY }, {}).catch((error) => error)
  assert.equal(first.status, undefined)
  assert.equal(first.message, "bad parameter [search_id: 3]")
  assert.equal(badRequest.calls.length, 1)

  const offline = api({}, [() => Promise.reject(new Error("ECONNRESET"))])
  const second = await offline.entry.execute({ query: "q", count: 5, key: KEY }, {}).catch((error) => error)
  assert.equal(second.status, undefined)
  assert.match(second.message, /ECONNRESET/)
  assert.equal(offline.calls.length, 1)

  const malformed = api({}, [new Response("<html>not json</html>", { status: 200 })])
  const third = await malformed.entry.execute({ query: "q", count: 5, key: KEY }, {}).catch((error) => error)
  assert.equal(third.status, undefined)
  assert.match(third.message, /not JSON/)
  assert.equal(malformed.calls.length, 1)

  const empty = api({}, [json({ error_code: 200 })])
  await assert.rejects(empty.entry.execute({ query: "q", count: 5, key: KEY }, {}), /results\.result/)
})

test("fails, without a status, when magpie passes no key", async () => {
  const { calls, entry } = api({}, [success()])

  const error = await entry.execute({ query: "q", count: 5, key: "" }, {}).then(
    () => assert.fail("expected a failure"),
    (caught) => caught,
  )

  assert.equal(error.status, undefined)
  assert.match(error.message, /no API key/)
  assert.equal(calls.length, 0)
})

test("stops when magpie aborts the search", async () => {
  const controller = new AbortController()
  const { entry } = api({}, [
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })
      }),
  ])

  const pending = entry.execute({ query: "q", count: 5, key: KEY }, { abort: controller.signal })
  controller.abort()
  const error = await pending.then(
    () => assert.fail("expected a failure"),
    (caught) => caught,
  )

  assert.equal(error.status, undefined)
  assert.match(error.message, /Querit search failed/)
})

test("strips escape sequences and control characters from untrusted text", async () => {
  const { entry } = api({}, [success([
    {
      title: "\u001b]0;owned\u0007Visible \u001b[31mtitle\u001b[0m\u202e",
      url: "https://example.com/a",
      snippet: "\u001b[2Jsnippet\nkept line\tand tab",
      page_age: "\u009b31m2d\u009b0m",
      highlights: ["\u001b]52;c;clipboard\u0007fragment"],
    },
  ])])

  const [page] = await entry.execute({ query: "q", count: 5, key: KEY }, {})

  assert.equal(page.title, "Visible title")
  assert.equal(page.text, "fragment\nsnippet\nkept line\tand tab")
  assert.equal(page.age, "2d")
})

test("rejects an oversized response before reading it", async () => {
  const { entry } = api({}, [json({ error_code: 200 }, { headers: { "content-length": String(3 * 1024 * 1024) } })])

  await assert.rejects(entry.execute({ query: "q", count: 5, key: KEY }, {}), /exceeds the 2\d+97152-byte limit/)
})
