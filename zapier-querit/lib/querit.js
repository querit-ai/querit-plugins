'use strict';

const { createHash } = require('node:crypto');
const { sanitizeErrorMessage, sanitizeUntrustedText } = require('./sanitize');

const QUERIT_API_BASE_URL = 'https://api.querit.ai';
const SEARCH_PATH = '/v1/search';
const SEARCH_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_EXCERPT_CHARS = 500;

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

const searchQuerit = async (z, bundle, requestBody) => {
  const apiKey = getApiKey(bundle);
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
      `Querit request failed: ${error instanceof Error ? error.message : String(error)}`,
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
      `Could not read the Querit response: ${error instanceof Error ? error.message : String(error)}`,
      apiKey,
      'QueritResponseError',
      response.status,
    );
  }

  const httpOk = response.status >= 200 && response.status < 300;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    const excerpt = sanitizeErrorMessage(text.slice(0, ERROR_EXCERPT_CHARS), apiKey);
    const message = httpOk
      ? `Querit returned invalid JSON${excerpt ? `: ${excerpt}` : '.'}`
      : `Querit API request failed with HTTP ${response.status}${excerpt ? `: ${excerpt}` : '.'}`;
    throwPlatformError(
      z,
      message,
      apiKey,
      httpOk ? 'QueritResponseError' : statusErrorCode(response.status),
      httpOk ? undefined : response.status,
    );
  }

  if (!isRecord(payload)) {
    throwPlatformError(
      z,
      'Querit returned an invalid response object.',
      apiKey,
      'QueritResponseError',
      httpOk ? undefined : response.status,
    );
  }

  const hasApiErrorCode = Object.prototype.hasOwnProperty.call(payload, 'error_code');
  const apiErrorCode = optionalString(payload.error_code);
  const numericApiErrorCode = apiErrorCode === undefined ? Number.NaN : Number(apiErrorCode);
  const hasBusinessError = hasApiErrorCode && numericApiErrorCode !== 200;

  if (!httpOk || hasBusinessError) {
    const apiErrorStatus = Number.isInteger(numericApiErrorCode)
      && numericApiErrorCode >= 400
      && numericApiErrorCode <= 599
      ? numericApiErrorCode
      : undefined;
    const httpStatus = httpOk ? undefined : response.status;
    const detail = optionalString(payload.error_msg);
    const fallback = !httpOk
      ? `Querit API request failed with HTTP ${response.status}.`
      : `Querit API request failed with error code ${apiErrorCode || 'unknown'}.`;
    throwPlatformError(
      z,
      detail || fallback,
      apiKey,
      statusErrorCode(httpStatus ?? apiErrorStatus),
      httpStatus,
    );
  }

  try {
    return normalizeSearchResponse(payload, text, requestBody.query);
  } catch (error) {
    throwPlatformError(
      z,
      error instanceof Error ? error.message : String(error),
      apiKey,
      'QueritResponseError',
    );
  }
};

const normalizeSearchResponse = (payload, rawText, requestedQuery) => {
  const resultsContainer = payload.results;
  if (!isRecord(resultsContainer) || !Array.isArray(resultsContainer.result)) {
    throw new Error('Querit search response is missing results.result.');
  }

  const searchId = extractSearchId(rawText, payload);
  const took = sanitizedString(payload.took) || '';
  const queryContext = isRecord(payload.query_context) ? payload.query_context : undefined;
  const query = queryContext
    ? sanitizedString(queryContext.query) || requestedQuery
    : requestedQuery;
  const deduplicated = new Map();

  for (const rawItem of resultsContainer.result) {
    if (!isRecord(rawItem)) continue;

    const url = normalizeHttpUrl(rawItem.url);
    if (!url || deduplicated.has(url)) continue;

    const sentences = Array.isArray(rawItem.sentence)
      ? rawItem.sentence
        .filter((value) => typeof value === 'string')
        .map((value) => sanitizeUntrustedText(value))
      : [];

    deduplicated.set(url, {
      id: stableResultId(url),
      title: sanitizedString(rawItem.title) || url,
      url,
      snippet: sanitizedString(rawItem.snippet) || '',
      page_age: sanitizedString(rawItem.page_age) || '',
      site_name: sanitizedString(rawItem.site_name) || '',
      site_icon: normalizeHttpUrl(rawItem.site_icon) || '',
      content: sentences.join('\n\n'),
      query,
      search_id: searchId || '',
      took,
    });
  }

  return [...deduplicated.values()].map((result, index) => ({
    ...result,
    rank: index + 1,
  }));
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

const extractSearchId = (rawText, payload) => {
  const numericMatch = /"search_id"\s*:\s*(-?\d+)/u.exec(rawText);
  if (numericMatch) return numericMatch[1];
  return sanitizedString(payload.search_id);
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

const isRecord = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

module.exports = {
  QUERIT_API_BASE_URL,
  SEARCH_PATH,
  addBearerAuthorization,
  searchQuerit,
};
