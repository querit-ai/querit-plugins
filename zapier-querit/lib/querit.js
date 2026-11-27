'use strict';

const { createHash } = require('node:crypto');
const { messageOf, sanitizeErrorMessage, sanitizeUntrustedText } = require('./sanitize');

const QUERIT_API_BASE_URL = 'https://api.querit.ai';
const SEARCH_PATH = '/v1/search';
const SEARCH_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_EXCERPT_CHARS = 500;
/** Querit documents these as the only statuses worth retrying; never 400, 401, 403, or 404. */
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
/** Retries after the first attempt. */
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;
/** Ceiling for backoff waits and for an honored Retry-After; a longer Retry-After is not waited out. */
const MAX_DELAY_MS = 5_000;

/**
 * A failed Querit response, kept structured until `searchQuerit` decides whether
 * to retry it or turn it into the error Zapier sees.
 */
class SearchFailure extends Error {
  constructor(message, { code, status, retryAfterMs, searchId } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.searchId = searchId;
  }
}

const getApiKey = (bundle) => {
  const value = bundle && bundle.authData && bundle.authData.apiKey;
  return typeof value === 'string' ? value.trim() : '';
};

const addBearerAuthorization = (request, z, bundle) => {
  const apiKey = getApiKey(bundle);
  if (!apiKey) {
    throw new z.errors.Error(
      'A Querit API key is required.',
      'AuthenticationError',
    );
  }

  request.headers = request.headers || {};
  request.headers.Authorization = `Bearer ${apiKey}`;
  return request;
};

/**
 * Posts a search, retrying the statuses Querit calls transient with bounded
 * exponential backoff. Failures carry `search_id` so support can trace the request.
 */
const searchQuerit = async (z, bundle, requestBody) => {
  const apiKey = getApiKey(bundle);

  for (let attempt = 0; ; attempt += 1) {
    let failure;
    try {
      return await attemptSearch(z, apiKey, requestBody);
    } catch (error) {
      if (!(error instanceof SearchFailure)) throw error;
      failure = error;
    }

    if (RETRYABLE_STATUSES.has(failure.status) && attempt < MAX_RETRIES) {
      const waitMs = retryDelayMs(failure.retryAfterMs, attempt);
      if (waitMs !== undefined) {
        await sleep(waitMs);
        continue;
      }
      // Honor an over-long Retry-After by not retrying sooner.
      failure = new SearchFailure(
        `${failure.message} Querit asked to retry after ${Math.ceil(failure.retryAfterMs / 1000)}s, `
        + `longer than the ${MAX_DELAY_MS} ms this integration waits; not retried.`,
        failure,
      );
    }

    throw toPlatformError(z, attempt === 0 ? failure : new SearchFailure(
      `Querit request failed after ${attempt + 1} attempts: ${failure.message}`,
      failure,
    ));
  }
};

const attemptSearch = async (z, apiKey, requestBody) => {
  let response;
  try {
    response = await z.request({
      url: `${QUERIT_API_BASE_URL}${SEARCH_PATH}`,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: requestBody,
      raw: true,
      redirect: 'error',
      skipThrowForStatus: true,
      // Keep the platform from turning a 429 into a ThrottledError before it can be retried.
      throwForThrottlingEarly: false,
      size: SEARCH_RESPONSE_MAX_BYTES,
      timeout: REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    if (
      error instanceof z.errors.ThrottledError
      || error instanceof z.errors.Error
    ) {
      throw error;
    }
    throwPlatformError(
      z,
      `Querit request failed: ${messageOf(error)}`,
      apiKey,
      'QueritRequestError',
    );
  }

  let text;
  try {
    text = await response.text();
  } catch (error) {
    throwPlatformError(
      z,
      `Could not read the Querit response: ${messageOf(error)}`,
      apiKey,
      'QueritResponseError',
      response.status,
    );
  }

  const httpStatus = response.status >= 200 && response.status < 300 ? undefined : response.status;
  const fail = (message, code, status = httpStatus) => new SearchFailure(
    sanitizeErrorMessage(message, apiKey) || 'Querit request failed.',
    {
      code,
      status,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      searchId: extractSearchId(text),
    },
  );

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    const excerpt = sanitizeErrorMessage(text.slice(0, ERROR_EXCERPT_CHARS), apiKey);
    if (httpStatus === undefined) {
      throw fail(`Querit returned invalid JSON${excerpt ? `: ${excerpt}` : '.'}`, 'QueritResponseError');
    }
    throw fail(
      `Querit API request failed with HTTP ${response.status}${excerpt ? `: ${excerpt}` : '.'}`,
      statusErrorCode(httpStatus),
    );
  }

  if (!isRecord(payload)) throw fail('Querit returned an invalid response object.', 'QueritResponseError');

  const hasApiErrorCode = Object.prototype.hasOwnProperty.call(payload, 'error_code');
  const apiErrorCode = optionalString(payload.error_code);
  const numericApiErrorCode = apiErrorCode === undefined ? Number.NaN : Number(apiErrorCode);

  // Querit asks clients to check error_code even on an HTTP 200.
  if (httpStatus !== undefined || (hasApiErrorCode && numericApiErrorCode !== 200)) {
    const apiErrorStatus = Number.isInteger(numericApiErrorCode)
      && numericApiErrorCode >= 400
      && numericApiErrorCode <= 599
      ? numericApiErrorCode
      : undefined;
    // error_code is the request's own verdict, and the status a retry is decided on; the
    // HTTP status stands in when the body carries no usable code.
    const status = httpStatus ?? apiErrorStatus;
    const detail = optionalString(payload.error_msg);
    const fallback = httpStatus === undefined
      ? `Querit API request failed with error code ${apiErrorCode || 'unknown'}.`
      : `Querit API request failed with HTTP ${response.status}.`;
    throw fail(detail || fallback, statusErrorCode(status), status);
  }

  try {
    return normalizeSearchResponse(payload, extractSearchId(text), requestBody.query);
  } catch (error) {
    throw fail(messageOf(error), 'QueritResponseError');
  }
};

/**
 * Support traces a request with `search_id`, so it closes the message the user sees.
 * A final 429 is raised the way the platform raises one by default: a `ThrottledError`
 * carrying the `Retry-After` delay.
 */
const toPlatformError = (z, failure) => {
  const message = failure.searchId
    ? `${failure.message} [search_id: ${failure.searchId}]`
    : failure.message;

  if (failure.status !== 429) return new z.errors.Error(message, failure.code, failure.status);
  return new z.errors.ThrottledError(
    message,
    failure.retryAfterMs === undefined ? undefined : Math.floor(failure.retryAfterMs / 1000),
  );
};

const retryDelayMs = (retryAfterMs, attempt) => {
  if (retryAfterMs !== undefined) {
    return retryAfterMs <= MAX_DELAY_MS ? retryAfterMs : undefined;
  }
  // Equal jitter: half the ceiling plus a random half, so waits back off without clustering.
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
};

/** Parses `Retry-After` in both forms the HTTP spec allows: delay-seconds or an HTTP-date. */
const parseRetryAfter = (value, now = Date.now()) => {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    return Math.max(0, Math.ceil(Number(trimmed) * 1_000));
  }
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - now);
};

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const normalizeSearchResponse = (payload, searchId, requestedQuery) => {
  const resultsContainer = payload.results;
  if (!isRecord(resultsContainer) || !Array.isArray(resultsContainer.result)) {
    throw new Error('Querit search response is missing results.result.');
  }

  const took = sanitizedString(payload.took) || '';
  const cost = formatCost(payload.cost);
  const queryContext = isRecord(payload.query_context) ? payload.query_context : undefined;
  const query = queryContext
    ? sanitizedString(queryContext.query) || requestedQuery
    : requestedQuery;
  const deduplicated = new Map();

  for (const rawItem of resultsContainer.result) {
    if (!isRecord(rawItem)) continue;

    const url = normalizeHttpUrl(rawItem.url);
    if (!url || deduplicated.has(url)) continue;

    deduplicated.set(url, {
      id: stableResultId(url),
      title: sanitizedString(rawItem.title) || url,
      url,
      snippet: sanitizedString(rawItem.snippet) || '',
      page_age: sanitizedString(rawItem.page_age) || '',
      site_name: sanitizedString(rawItem.site_name) || '',
      site_icon: normalizeHttpUrl(rawItem.site_icon) || '',
      content: sanitizedStringList(rawItem.sentence).join('\n\n'),
      highlights: sanitizedStringList(rawItem.highlights).join('\n\n'),
      query,
      search_id: searchId || '',
      took,
      cost,
    });
  }

  return [...deduplicated.values()].map((result, index) => ({
    ...result,
    rank: index + 1,
  }));
};

/** Renders `cost` at Querit's six-decimal precision; empty means unavailable, never a reported zero. */
const formatCost = (value) => {
  if (!isRecord(value) || !Number.isFinite(value.total) || value.total < 0) return '';
  const currency = sanitizedString(value.currency);
  return currency ? `${currency} ${value.total.toFixed(6)}` : '';
};

const normalizeHttpUrl = (value) => {
  if (typeof value !== 'string' || value.length > 4096) return undefined;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
};

const stableResultId = (url) => createHash('sha256').update(url).digest('hex');

/** Reads the integer straight from the response text so large ids keep every digit. */
const extractSearchId = (rawText) => {
  const numericMatch = /"search_id"\s*:\s*(?:"(-?\d+)"|(-?\d+))/u.exec(rawText);
  return numericMatch ? numericMatch[1] || numericMatch[2] : undefined;
};

const throwPlatformError = (z, message, apiKey, code, status) => {
  const safeMessage = sanitizeErrorMessage(message, apiKey) || 'Querit request failed.';
  if (Number.isInteger(status)) {
    throw new z.errors.Error(safeMessage, code, status);
  }
  throw new z.errors.Error(safeMessage, code);
};

const statusErrorCode = (status) => (
  status === 401 || status === 403 ? 'AuthenticationError' : 'QueritAPIError'
);

const optionalString = (value) => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

/** Remote text lands in Zap fields and downstream automations, so strip control sequences. */
const sanitizedString = (value) => {
  const text = optionalString(value);
  return text === undefined ? undefined : sanitizeUntrustedText(text);
};

const sanitizedStringList = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string').map((item) => sanitizeUntrustedText(item))
    : []
);

const isRecord = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

module.exports = {
  addBearerAuthorization,
  searchQuerit,
};
