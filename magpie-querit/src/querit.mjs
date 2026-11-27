/**
 * Querit search API for magpie's `search` hook.
 *
 * magpie keeps the API key and calls `execute({ query, count, key }, { abort })`
 * for one search. It expects `[{ title, url, text?, age? }]`. A throw with an
 * integer `status` (401, 402, 403, 429) means the key was refused, which magpie
 * rests as it does a built-in API's; any other throw is a failure, and magpie
 * asks the next search API. So only a refusal ever carries `status`.
 *
 * Request and response shapes follow Querit's official Search API reference
 * (https://www.querit.ai/en/docs/reference/post).
 * @module magpie-querit/querit
 */
import { createRequire } from "node:module";

const QUERIT_API_BASE_URL = "https://api.querit.ai";
/** Where a key comes from; shown as the API's "Get a key" link. */
const QUERIT_KEYS_URL = "https://www.querit.ai/";

const SEARCH_PATH = "/v1/search";
const RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const ERROR_MAX_BYTES = 8 * 1024;
/** Largest `count` the API accepts. */
const COUNT_LIMIT = 100;
/**
 * One search API gets a quarter of a search's limit, 30 s, before magpie's
 * `abort` fires. Stop short of that to answer with a clean failure instead.
 */
const REQUEST_TIMEOUT_MS = 25_000;
/** Querit documents these as transient. A refusal is never retried here, so magpie can rest the key. */
const RETRYABLE_STATUSES = new Set([500, 503]);
const RETRY_DELAYS_MS = [400];
/** Statuses magpie rests a key for. */
const REFUSED_STATUSES = new Set([401, 402, 403, 429]);
/** `dN`/`wN`/`mN`/`yN` (N ≥ 1) or an inclusive `YYYY-MM-DDtoYYYY-MM-DD` range. */
const TIME_RANGE_PATTERN = /^(?:[dwmy][1-9][0-9]*|\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2})$/u;
const VERTICALS = new Set(["code", "finance"]);

const USER_AGENT = `magpie-querit/${createRequire(import.meta.url)("../package.json").version}`;

/**
 * Build the search API one plugin entry registers.
 * @param {object} options - the entry's options as magpie saves them:
 *   `baseUrl` (string), `timeRange` (string), `vertical` ("code" | "finance"),
 *   `highlights` (boolean). Read on every search, so a change applies without
 *   a restart. Anything missing or invalid is left unset.
 * @param {{ fetchImpl?: typeof fetch, sleep?: (ms: number, signal?: AbortSignal) => Promise<void> }} deps
 *   Overrides for tests.
 * @returns {{ id: string, name: string, keysURL: string, execute: Function }} The `search` entry.
 */
export function createQueritSearchApi(options = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const sleep = deps.sleep ?? delay;

  function settings() {
    const raw = options && typeof options === "object" ? options : {};
    const timeRange = typeof raw.timeRange === "string" ? raw.timeRange.trim() : "";
    return {
      baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.trim()
        ? raw.baseUrl.trim().replace(/\/+$/, "")
        : QUERIT_API_BASE_URL,
      timeRange: TIME_RANGE_PATTERN.test(timeRange) ? timeRange : undefined,
      vertical: VERTICALS.has(raw.vertical) ? raw.vertical : undefined,
      highlights: raw.highlights === true,
    };
  }

  async function execute({ query, count, key }, ctx = {}) {
    const apiKey = typeof key === "string" ? key.trim() : "";
    if (!apiKey) throw failure("Querit: magpie passed no API key for this search API.");

    const { baseUrl, timeRange, vertical, highlights } = settings();
    const filters = {};
    if (timeRange) filters.timeRange = { date: timeRange };
    if (vertical) filters.vertical = vertical;
    const requested = Number.isInteger(count) && count >= 1 ? Math.min(count, COUNT_LIMIT) : undefined;
    const signal = AbortSignal.any([ctx.abort, AbortSignal.timeout(REQUEST_TIMEOUT_MS)].filter(Boolean));

    for (let attempt = 0; ; attempt += 1) {
      try {
        return toPages(await post(fetchImpl, baseUrl, apiKey, {
          query,
          // Nothing chosen means nothing sent: Querit applies its own default.
          ...(requested === undefined ? {} : { count: requested }),
          ...(highlights ? { highlights: true } : {}),
          ...(Object.keys(filters).length === 0 ? {} : { filters }),
        }, signal));
      } catch (error) {
        if (!RETRYABLE_STATUSES.has(error?.queritStatus) || attempt >= RETRY_DELAYS_MS.length) throw error;
        try {
          await sleep(RETRY_DELAYS_MS[attempt], signal);
        } catch (cancelled) {
          throw failure("Querit search was cancelled while waiting to retry.", { cause: cancelled });
        }
      }
    }
  }

  return {
    id: "querit",
    name: "Querit",
    keysURL: QUERIT_KEYS_URL,
    execute,
  };
}

/** A refusal of the key: the only error kind that carries `status`. */
class Refusal extends Error {
  constructor(message, status, retryAfter) {
    super(message);
    this.status = status;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

/**
 * Any other failure. `queritStatus` is what the retry decision reads; magpie
 * must never see a `status` on it, or it would rest a key Querit did not refuse.
 */
function failure(message, { queritStatus, cause } = {}) {
  const error = new Error(message);
  if (queritStatus !== undefined) error.queritStatus = queritStatus;
  if (cause !== undefined) error.cause = cause;
  return error;
}

async function post(fetchImpl, baseUrl, apiKey, body, signal) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${SEARCH_PATH}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw failure(`Querit search failed: ${messageOf(error)}`, { cause: error });
  }

  // search_id can exceed 2^53, so it is read from the text before JSON.parse rounds it.
  let text;
  let searchId;
  try {
    text = await readText(response, response.ok ? RESPONSE_MAX_BYTES : ERROR_MAX_BYTES);
    searchId = searchIdIn(text);
  } catch (error) {
    throw failure(`Could not read the Querit response: ${messageOf(error)}`, {
      queritStatus: response.status,
      cause: error,
    });
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw failure(
      `Querit returned HTTP ${response.status} with a body that is not JSON${excerptOf(text, apiKey)}`,
      { queritStatus: response.status, cause: error },
    );
  }
  if (!isRecord(payload)) {
    throw failure(`Querit returned HTTP ${response.status} with an invalid response object.`, {
      queritStatus: response.status,
    });
  }

  // Querit asks clients to check error_code even on an HTTP 200.
  const code = Number(payload.error_code);
  if (!response.ok || (Number.isFinite(code) && code !== 200)) {
    const status = response.ok ? code : response.status;
    const detail = redact(
      `${typeof payload.error_msg === "string" && payload.error_msg
        ? payload.error_msg
        : `Querit API request failed with HTTP ${response.status}.`}`
        // Support traces a request by search_id alone.
        + `${searchId ? ` [search_id: ${searchId}]` : ""}`,
      apiKey,
    );
    if (REFUSED_STATUSES.has(status)) {
      throw new Refusal(detail, status, retryAfterSeconds(response.headers.get("retry-after")));
    }
    throw failure(detail, { queritStatus: Number.isFinite(status) ? status : undefined });
  }
  return payload;
}

/** Map `results.result[]` to magpie's pages. Every Querit result field is optional. */
function toPages(payload) {
  const items = isRecord(payload.results) ? payload.results.result : undefined;
  if (!Array.isArray(items)) throw failure("Querit search response is missing results.result.");

  const seen = new Set();
  const pages = [];
  for (const item of items) {
    const url = isRecord(item) ? httpUrl(item.url) : undefined;
    // magpie drops a page without a URL, so such a result could never be cited.
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const highlights = stringList(item.highlights).map(cleanText).filter(Boolean);
    const snippet = cleanText(textOf(item.snippet));
    const age = cleanText(textOf(item.page_age));
    pages.push({
      title: cleanText(textOf(item.title)) || url,
      url,
      // Highlights lead: Querit selects them against the query. magpie clips the tail.
      text: [highlights.join("\n"), snippet].filter(Boolean).join("\n"),
      ...(age ? { age } : {}),
    });
  }
  return pages;
}

async function readText(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`response exceeds the ${maxBytes}-byte limit`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("response size limit exceeded");
        throw new Error(`response exceeds the ${maxBytes}-byte limit`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** The request's `search_id` as printed in the response, digits exactly as sent. */
function searchIdIn(text) {
  const match = /"search_id"\s*:\s*(?:"([^"]+)"|(-?\d+))/.exec(text);
  const value = match?.[1] ?? match?.[2];
  return value && /^-?\d+$/.test(value) ? value : undefined;
}

/** `Retry-After` as whole seconds, in either form HTTP allows; undefined when absent or unreadable. */
function retryAfterSeconds(value) {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1_000)) : undefined;
}

function excerptOf(text, secret) {
  const excerpt = redact(cleanText(text.slice(0, 500)), secret);
  return excerpt ? `: ${excerpt}` : ".";
}

/** A normalized HTTP(S) URL, or undefined for anything a result cannot be cited by. */
function httpUrl(value) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Drop escape sequences, control characters, and bidi controls from untrusted
 * text; keep line breaks and tabs. Sequences are removed whole, in their ESC
 * form and their one-byte C1 form, so no parameter bytes are left behind.
 */
function cleanText(value) {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u009b[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, "")
    .replace(/\u009d[^\u009c\u001b]*(?:\u009c|\u001b\\)?/g, "")
    .replace(/\u001b[@-Z\\-_]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value) {
  return typeof value === "string" ? value : "";
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function redact(value, secret) {
  return secret ? value.split(secret).join("[REDACTED]") : value;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    // A signal that is already aborted fires no event, so it is checked first.
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
