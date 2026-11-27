'use strict';

const nock = require('nock');
const zapier = require('zapier-platform-core');
const App = require('../index');

const appTester = zapier.createAppTester(App);
const TEST_API_KEY = 'unit-test-api-key-placeholder';
const OPERATION = App.searches.web_search.operation;
const SEARCH = OPERATION.perform;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const CUSTOM_TIME_RANGE_MESSAGE = 'Custom Time Range must be a period such as d30, w6, m2, or y3, '
  + 'or a date range like 2026-01-01to2026-03-31 with the start date on or before the end date.';

// The real setTimeout, captured before any test replaces it.
const realSetTimeout = global.setTimeout;
// Matches the request timeout the integration hands to node-fetch; longer timers are left alone.
const REQUEST_TIMEOUT_MS = 30_000;

const inputField = (key) => OPERATION.inputFields.find((field) => field.key === key);

const bundle = (inputData = {}) => ({
  authData: { apiKey: TEST_API_KEY },
  inputData,
});

const replyToSearch = (status, body, headers = JSON_HEADERS) => (
  nock('https://api.querit.ai')
    .post('/v1/search')
    .reply(status, body, headers)
);

/** Accepts exactly one request whose JSON body deep-equals `body`. */
const expectRequestBody = (body) => nock('https://api.querit.ai')
  .post('/v1/search', body)
  .reply(200, { error_code: 200, results: { result: [] } });

/** Answers every search with the same response; returns a function counting the requests so far. */
const alwaysReply = (status, body, headers = JSON_HEADERS) => {
  let requests = 0;
  nock('https://api.querit.ai')
    .persist()
    .post('/v1/search')
    .reply(() => {
      requests += 1;
      return [status, body, headers];
    });
  return () => requests;
};

/**
 * Records each backoff wait the integration asks for and resolves it on the next tick instead,
 * so retry logic is exercised without slowing the suite. Returns the list of waits in milliseconds.
 */
const recordBackoffWaits = () => {
  const waits = [];
  jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    if (delay >= REQUEST_TIMEOUT_MS) return realSetTimeout(callback, delay, ...args);
    waits.push(delay);
    return realSetTimeout(callback, 0, ...args);
  });
  return waits;
};

const captureError = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the Zapier app tester call to reject.');
};

const parseAppError = (error) => {
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('AppError');
  return JSON.parse(error.message);
};

const parseThrottledError = (error) => {
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('ThrottledError');
  return JSON.parse(error.message);
};

beforeAll(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  // Clean up before asserting, so one missed request does not fail every later test too.
  const allRequested = nock.isDone();
  nock.cleanAll();
  jest.restoreAllMocks();
  expect(allRequested).toBe(true);
});

describe('custom authentication', () => {
  it('defines the API key as a required password field', () => {
    expect(App.authentication.type).toBe('custom');
    expect(App.authentication.fields).toEqual([
      expect.objectContaining({
        key: 'apiKey',
        type: 'password',
        required: true,
        helpText: expect.stringMatching(
          /\[Querit account\]\(https:\/\/www\.querit\.ai\)/u,
        ),
      }),
    ]);
    expect(App.authentication.connectionLabel).toBe('Querit Account');
  });

  it('rejects a missing API key before making a network request', async () => {
    const error = parseAppError(await captureError(
      appTester(SEARCH, {
        authData: { apiKey: '   ' },
        inputData: { query: 'missing authentication' },
      }),
    ));

    expect(error).toEqual({
      code: 'AuthenticationError',
      message: 'A Querit API key is required.',
    });
  });

  it('tests auth with a fixed one-result POST and bearer authorization', async () => {
    const request = nock('https://api.querit.ai', {
      reqheaders: {
        accept: 'application/json',
        authorization: `Bearer ${TEST_API_KEY}`,
        'content-type': 'application/json',
      },
    })
      .post('/v1/search', {
        query: 'Querit authentication test',
        count: 1,
      })
      .reply(200, {
        error_code: 200,
        results: { result: [] },
      });

    await expect(appTester(App.authentication.test, {
      authData: { apiKey: TEST_API_KEY },
    })).resolves.toEqual({ authenticated: true });
    expect(request.isDone()).toBe(true);
  });
});

describe('Find Web Search Results', () => {
  it('is the only public operation and uses publishing-compliant copy', () => {
    expect(Object.keys(App.searches)).toEqual(['web_search']);
    expect(OPERATION.cleanInputData).toBe(false);
    expect(App.searches.web_search.display).toEqual({
      label: 'Find Web Search Results',
      description: 'Finds live web search results.',
    });
    expect(App.triggers).toEqual({});
    expect(App.creates).toEqual({});
  });

  it('defines the documented input fields without forcing a result count', () => {
    expect(OPERATION.inputFields.map((field) => field.key)).toEqual([
      'query',
      'count',
      'time_range',
      'time_range_custom',
      'countries',
      'languages',
      'include_domains',
      'exclude_domains',
      'vertical',
      'resource_tags',
      'rank_preference',
      'include_content',
      'content_max_chars',
      'highlights',
      'highlights_max_characters',
      'chunks_per_doc',
    ]);

    expect(inputField('count')).toMatchObject({
      type: 'integer',
      required: false,
      helpText: expect.stringMatching(/1 to 100.*Querit's default count/u),
    });
    expect(inputField('count')).not.toHaveProperty('default');
    expect(Object.keys(inputField('languages').choices)).toEqual([
      'english', 'japanese', 'korean', 'german', 'french', 'spanish', 'portuguese', 'russian',
    ]);
    expect(inputField('time_range').choices).toEqual({
      d7: 'Past 7 days',
      w2: 'Past 2 weeks',
      m3: 'Past 3 months',
      y1: 'Past year',
    });
    expect(inputField('time_range_custom')).toMatchObject({ type: 'string', required: false });
    expect(inputField('vertical').choices).toEqual({ code: 'Code', finance: 'Finance' });
    expect(inputField('resource_tags')).toMatchObject({
      list: true,
      choices: { qa: 'Q&A pages', github: 'GitHub' },
    });
    expect(inputField('rank_preference').choices).toEqual({
      relevance: 'Relevance',
      freshness: 'Freshness',
    });
    expect(inputField('highlights')).toMatchObject({ type: 'boolean', required: false });
    expect(inputField('highlights_max_characters')).toMatchObject({ type: 'integer', required: false });
    expect(inputField('content_max_chars')).toMatchObject({ type: 'integer', required: false });
    expect(inputField('chunks_per_doc').helpText).toMatch(/Deprecated by Querit/u);
  });

  it('sends only the query when no optional field is set', async () => {
    const request = expectRequestBody({ query: 'Node.js 22 runtime' });

    await expect(appTester(SEARCH, bundle({ query: '  Node.js 22 runtime  ' }))).resolves.toEqual([]);
    expect(request.isDone()).toBe(true);
  });

  it('omits toggles that are off so Querit applies its own defaults', async () => {
    const request = expectRequestBody({ query: 'plain search' });

    await expect(appTester(SEARCH, bundle({
      query: 'plain search',
      highlights: 'false',
      include_content: false,
      count: '',
      vertical: '',
    }))).resolves.toEqual([]);
    expect(request.isDone()).toBe(true);
  });

  it('builds the documented Querit request body with optional filters', async () => {
    const request = expectRequestBody({
      query: 'Node.js 22 runtime',
      count: 7,
      chunksPerDoc: 2,
      needContent: true,
      filters: {
        sites: {
          include: ['example.com', 'docs.example.com'],
          exclude: ['noise.example'],
        },
        timeRange: { date: 'm3' },
        geo: { countries: { include: ['united states', 'japan'] } },
        languages: { include: ['english', 'russian'] },
      },
    });

    await expect(appTester(SEARCH, bundle({
      query: '  Node.js 22 runtime  ',
      count: '7',
      chunks_per_doc: 2,
      include_content: 'true',
      include_domains: ['Example.com', 'docs.example.com', 'example.com'],
      exclude_domains: ['noise.example'],
      time_range: 'm3',
      countries: ['United States', 'japan', 'JAPAN'],
      languages: ['English', 'RUSSIAN'],
    }))).resolves.toEqual([]);
    expect(request.isDone()).toBe(true);
  });

  it('accepts the documented maximum count', async () => {
    const request = expectRequestBody({ query: 'many results', count: 100 });

    await expect(appTester(SEARCH, bundle({ query: 'many results', count: 100 }))).resolves.toEqual([]);
    expect(request.isDone()).toBe(true);
  });

  it.each([
    ['a toggle', { highlights: 'true' }, true],
    ['a maximum length', { highlights: true, highlights_max_characters: 300 }, { maxCharacters: 300 }],
  ])('sends highlights as %s', async (_label, inputData, highlights) => {
    const request = expectRequestBody({ query: 'replication lag', highlights });

    await expect(appTester(SEARCH, bundle({ query: 'replication lag', ...inputData }))).resolves.toEqual([]);
    expect(request.isDone()).toBe(true);
  });

  it('limits requested body text to a maximum number of characters', async () => {
    const request = expectRequestBody({
      query: 'long pages',
      needContent: true,
      contentMaxChars: 2_000,
    });

    await expect(appTester(SEARCH, bundle({
      query: 'long pages',
      include_content: true,
      content_max_chars: '2000',
    }))).resolves.toEqual([]);
    expect(request.isDone()).toBe(true);
  });

  it('scopes the search to a vertical with its resource tags', async () => {
    const request = expectRequestBody({
      query: 'asyncio semaphore',
      filters: {
        vertical: 'code',
        resourceTags: { include: ['github', 'qa'] },
      },
    });

    await expect(appTester(SEARCH, bundle({
      query: 'asyncio semaphore',
      vertical: 'Code',
      resource_tags: ['GitHub', 'qa'],
    }))).resolves.toEqual([]);
    expect(request.isDone()).toBe(true);
  });

  it('boosts results by rank preference', async () => {
    const request = expectRequestBody({
      query: 'AI chip export policy',
      rank: { preference: 'freshness' },
      filters: { vertical: 'finance' },
    });

    await expect(appTester(SEARCH, bundle({
      query: 'AI chip export policy',
      rank_preference: 'freshness',
      vertical: 'finance',
    }))).resolves.toEqual([]);
    expect(request.isDone()).toBe(true);
  });

  it.each([
    ['a relative period', 'D30', 'd30'],
    ['a date range', '2026-01-01to2026-03-31', '2026-01-01to2026-03-31'],
    ['a single day', '2026-01-01to2026-01-01', '2026-01-01to2026-01-01'],
  ])('sends a custom time range as %s', async (_label, value, date) => {
    const request = expectRequestBody({ query: 'news', filters: { timeRange: { date } } });

    await expect(appTester(SEARCH, bundle({ query: 'news', time_range_custom: value }))).resolves.toEqual([]);
    expect(request.isDone()).toBe(true);
  });

  it('maps, normalizes, and deduplicates results into flat records with stable ids', async () => {
    const rawResponse = JSON.stringify({
      error_code: 200,
      search_id: '9007199254740993123',
      took: '0.42s',
      query_context: { query: 'resolved query' },
      results: {
        result: [
          {
            title: 'First',
            url: '  https://EXAMPLE.com:443/a#first  ',
            snippet: 'Summary',
            page_age: 2,
            site_name: 'Example',
            site_icon: '  https://EXAMPLE.com:443/favicon.ico#icon  ',
            sentence: ['Sentence one.', 42, 'Sentence two.'],
          },
          {
            title: 'Duplicate Fragment',
            url: 'https://example.com/a#second',
            snippet: 'This must be removed.',
          },
          {
            url: 'http://example.org',
            snippet: 17,
          },
          { title: 'Credentials', url: 'https://user:pass@example.net/private' },
          { title: 'Unsafe', url: 'javascript:alert(1)' },
          { title: 'Malformed URL', url: 'not a url' },
          null,
        ],
      },
    }).replace(
      '"search_id":"9007199254740993123"',
      '"search_id":9007199254740993123',
    );
    replyToSearch(200, rawResponse);

    const results = await appTester(SEARCH, bundle({ query: 'original query', count: 5 }));

    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: '2dce0a4c50441bfccfa9caf4b58c3cba6e06c420505dd829f0436de1aa44baac',
      rank: 1,
      title: 'First',
      url: 'https://example.com/a',
      snippet: 'Summary',
      page_age: '2',
      site_name: 'Example',
      site_icon: 'https://example.com/favicon.ico',
      content: 'Sentence one.\n\nSentence two.',
      highlights: '',
      query: 'resolved query',
      search_id: '9007199254740993123',
      took: '0.42s',
      cost: '',
    });
    expect(results[1]).toEqual({
      id: '781bc04ec9bd049cdfacaec4ae2026102118d13c79413246f0c88eeef6ebec4e',
      rank: 2,
      title: 'http://example.org/',
      url: 'http://example.org/',
      snippet: '17',
      page_age: '',
      site_name: '',
      site_icon: '',
      content: '',
      highlights: '',
      query: 'resolved query',
      search_id: '9007199254740993123',
      took: '0.42s',
      cost: '',
    });
    expect(results).not.toHaveProperty('results');
    expect(Object.values(results[0]).every((value) => (
      typeof value === 'string' || typeof value === 'number'
    ))).toBe(true);
  });

  it('returns query-focused highlights and the reported cost with each result', async () => {
    replyToSearch(200, {
      error_code: 200,
      search_id: 8,
      took: '312ms',
      cost: { currency: 'USD', total: 0.000123 },
      results: {
        result: [
          { url: 'https://example.com/a', highlights: ['Relevant fragment.', 7, 'Second fragment.'] },
          { url: 'https://example.com/b', highlights: 'not a list' },
        ],
      },
    });

    const results = await appTester(SEARCH, bundle({ query: 'highlights', highlights: true }));

    expect(results.map((result) => [result.highlights, result.cost, result.search_id, result.took])).toEqual([
      ['Relevant fragment.\n\nSecond fragment.', 'USD 0.000123', '8', '312ms'],
      ['', 'USD 0.000123', '8', '312ms'],
    ]);
  });

  it.each([
    ['absent', '', undefined],
    ['a reported zero', 'USD 0.000000', { currency: 'USD', total: 0 }],
    ['a non-numeric value', '', { currency: 'USD', total: '0.5' }],
    ['a negative value', '', { currency: 'USD', total: -1 }],
  ])('maps a cost that is %s to "%s"', async (_label, expected, cost) => {
    replyToSearch(200, {
      error_code: 200,
      ...(cost === undefined ? {} : { cost }),
      results: { result: [{ url: 'https://example.com/a' }] },
    });

    const results = await appTester(SEARCH, bundle({ query: 'cost' }));
    expect(results[0].cost).toBe(expected);
  });

  it('returns an empty array when Querit has no results', async () => {
    replyToSearch(200, {
      error_code: '200',
      search_id: '42',
      results: { result: [] },
    });

    await expect(appTester(SEARCH, bundle({ query: 'nothing found' }))).resolves.toEqual([]);
  });

  it('rejects a malformed success payload', async () => {
    replyToSearch(200, { error_code: 200, results: [] });

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'malformed' })),
    ));
    expect(error).toMatchObject({
      code: 'QueritResponseError',
      message: 'Querit search response is missing results.result.',
    });
  });

  it('gives up after the default budget of two retries and reports the attempt count', async () => {
    const requests = alwaysReply(503, {
      error_code: 503,
      error_msg: 'Querit is temporarily unavailable.',
      search_id: 5,
    });
    recordBackoffWaits();

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'service status' })),
    ));

    expect(error).toEqual({
      code: 'QueritAPIError',
      message: 'Querit request failed after 3 attempts: Querit is temporarily unavailable. [search_id: 5]',
      status: 503,
    });
    expect(requests()).toBe(3);
  });

  it.each([429, 500, 503])('retries an HTTP %i with backoff until a request succeeds', async (status) => {
    replyToSearch(status, { error_code: status });
    replyToSearch(200, { error_code: 200, results: { result: [{ url: 'https://example.com/a' }] } });
    const waits = recordBackoffWaits();

    await expect(appTester(SEARCH, bundle({ query: 'transient failure' }))).resolves.toHaveLength(1);
    expect(waits).toHaveLength(1);
  });

  it('never retries 400, 401, 403, or 404', async () => {
    const waits = recordBackoffWaits();

    for (const status of [400, 401, 403, 404]) {
      const requests = alwaysReply(status, { error_code: status, error_msg: `failed ${status}` });

      const error = parseAppError(await captureError(
        appTester(SEARCH, bundle({ query: 'permanent failure' })),
      ));

      expect(error.code).toBe(status === 401 || status === 403 ? 'AuthenticationError' : 'QueritAPIError');
      expect(requests()).toBe(1);
      nock.cleanAll();
    }
    expect(waits).toEqual([]);
  });

  // Querit documents error_code as matching the HTTP status, and asks for it to be checked on a 200 too.
  it('retries a transient error_code carried in an HTTP 200 response', async () => {
    replyToSearch(200, { error_code: 503, error_msg: 'Querit is temporarily unavailable.', search_id: 9 });
    replyToSearch(200, { error_code: 200, results: { result: [{ url: 'https://example.com/a' }] } });
    const waits = recordBackoffWaits();

    await expect(appTester(SEARCH, bundle({ query: 'business error' }))).resolves.toHaveLength(1);
    expect(waits).toHaveLength(1);
  });

  it('does not retry a permanent error_code carried in an HTTP 200 response', async () => {
    const requests = alwaysReply(200, {
      error_code: 403,
      error_msg: 'No Search API access.',
      search_id: 9,
    });
    const waits = recordBackoffWaits();

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'business error' })),
    ));

    expect(error).toEqual({
      code: 'AuthenticationError',
      message: 'No Search API access. [search_id: 9]',
      status: 403,
    });
    expect(requests()).toBe(1);
    expect(waits).toEqual([]);
  });

  it('raises a 429 carried in an HTTP 200 as the platform throttling error once retries run out', async () => {
    const requests = alwaysReply(
      200,
      { error_code: 429, error_msg: 'Too many searches.', search_id: 13 },
      { 'Content-Type': 'application/json', 'Retry-After': '2' },
    );
    const waits = recordBackoffWaits();

    const error = parseThrottledError(await captureError(
      appTester(SEARCH, bundle({ query: 'rate limited' })),
    ));

    expect(error).toEqual({
      message: 'Querit request failed after 3 attempts: Too many searches. [search_id: 13]',
      delay: 2,
    });
    expect(requests()).toBe(3);
    expect(waits).toEqual([2_000, 2_000]);
  });

  it('does not retry network failures', async () => {
    let requests = 0;
    const scope = nock('https://api.querit.ai')
      .persist()
      .post('/v1/search')
      .replyWithError('socket hang up');
    scope.on('request', () => {
      requests += 1;
    });
    const waits = recordBackoffWaits();

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'network failure' })),
    ));

    expect(error.code).toBe('QueritRequestError');
    expect(error.message).toContain('socket hang up');
    expect(requests).toBe(1);
    expect(waits).toEqual([]);
  });

  it('reports a permanent failure that follows a retry with the attempt count', async () => {
    replyToSearch(503, { error_code: 503, search_id: 4 });
    replyToSearch(401, { error_code: 401, error_msg: `Invalid ${TEST_API_KEY}`, search_id: 7 });
    recordBackoffWaits();

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'mixed failures' })),
    ));

    expect(error).toEqual({
      code: 'AuthenticationError',
      message: 'Querit request failed after 2 attempts: Invalid [REDACTED] [search_id: 7]',
      status: 401,
    });
  });

  it('retries a non-JSON transient failure and reports its status', async () => {
    const requests = alwaysReply(
      503,
      '<html>Service Unavailable</html>',
      { 'Content-Type': 'text/html' },
    );
    recordBackoffWaits();

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'gateway error' })),
    ));

    expect(error).toEqual({
      code: 'QueritAPIError',
      message: 'Querit request failed after 3 attempts: Querit API request failed with HTTP 503: <html>Service Unavailable</html>',
      status: 503,
    });
    expect(requests()).toBe(3);
  });

  it('waits for a bounded, jittered backoff between attempts', async () => {
    alwaysReply(500, { error_code: 500 });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const waits = recordBackoffWaits();

    await captureError(appTester(SEARCH, bundle({ query: 'backoff floor' })));
    expect(waits).toEqual([250, 500]);
  });

  it('doubles the backoff up to its ceiling as jitter grows', async () => {
    alwaysReply(500, { error_code: 500 });
    jest.spyOn(Math, 'random').mockReturnValue(1);
    const waits = recordBackoffWaits();

    await captureError(appTester(SEARCH, bundle({ query: 'backoff ceiling' })));
    expect(waits).toEqual([500, 1000]);
  });

  it('honors a Retry-After that fits the wait budget', async () => {
    replyToSearch(
      429,
      { error_code: 429, error_msg: 'Too many searches.', search_id: 12 },
      { 'Content-Type': 'application/json', 'Retry-After': '2' },
    );
    replyToSearch(200, { error_code: 200, results: { result: [] } });
    const waits = recordBackoffWaits();

    await expect(appTester(SEARCH, bundle({ query: 'throttled search' }))).resolves.toEqual([]);
    expect(waits).toEqual([2000]);
  });

  it('reads an HTTP-date Retry-After', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2025-12-31T23:59:58Z'));
    replyToSearch(
      503,
      { error_code: 503 },
      { 'Content-Type': 'application/json', 'Retry-After': 'Thu, 01 Jan 2026 00:00:00 GMT' },
    );
    replyToSearch(200, { error_code: 200, results: { result: [] } });
    const waits = recordBackoffWaits();

    await expect(appTester(SEARCH, bundle({ query: 'dated retry' }))).resolves.toEqual([]);
    expect(waits).toEqual([2000]);
  });

  it('waits out the Retry-After delay in real time before retrying', async () => {
    const receivedAt = [];
    nock('https://api.querit.ai')
      .post('/v1/search')
      .reply(() => {
        receivedAt.push(Date.now());
        return [503, { error_code: 503 }, { 'Content-Type': 'application/json', 'Retry-After': '1' }];
      });
    nock('https://api.querit.ai')
      .post('/v1/search')
      .reply(() => {
        receivedAt.push(Date.now());
        return [200, { error_code: 200, results: { result: [] } }, JSON_HEADERS];
      });

    await appTester(SEARCH, bundle({ query: 'real time' }));

    expect(receivedAt).toHaveLength(2);
    expect(receivedAt[1] - receivedAt[0]).toBeGreaterThanOrEqual(1_000);
  });

  it('does not wait out a Retry-After longer than the budget', async () => {
    const requests = alwaysReply(
      429,
      { error_code: 429, error_msg: 'Too many searches.', search_id: 11 },
      { 'Content-Type': 'application/json', 'Retry-After': '12' },
    );
    const waits = recordBackoffWaits();

    const error = parseThrottledError(await captureError(
      appTester(SEARCH, bundle({ query: 'long throttle' })),
    ));

    expect(error).toEqual({
      message: 'Too many searches. Querit asked to retry after 12s, longer than the 5000 ms this integration waits; not retried. [search_id: 11]',
      delay: 12,
    });
    expect(requests()).toBe(1);
    expect(waits).toEqual([]);
  });

  it('reports an exhausted 429 as the platform throttling error', async () => {
    const requests = alwaysReply(429, { error_code: 429, error_msg: 'Too many searches.', search_id: 6 });
    recordBackoffWaits();

    const error = parseThrottledError(await captureError(
      appTester(SEARCH, bundle({ query: 'throttled search' })),
    ));

    expect(error).toEqual({
      message: 'Querit request failed after 3 attempts: Too many searches. [search_id: 6]',
    });
    expect(requests()).toBe(3);
  });

  it('keeps the platform throttling error when a retry ends in a 429', async () => {
    replyToSearch(503, { error_code: 503 });
    replyToSearch(
      429,
      { error_code: 429, error_msg: 'Too many searches.', search_id: 6 },
      { 'Content-Type': 'application/json', 'Retry-After': '12' },
    );
    recordBackoffWaits();

    const error = parseThrottledError(await captureError(
      appTester(SEARCH, bundle({ query: 'mixed throttle' })),
    ));

    expect(error).toEqual({
      message: 'Querit request failed after 2 attempts: Too many searches. Querit asked to retry after 12s, longer than the 5000 ms this integration waits; not retried. [search_id: 6]',
      delay: 12,
    });
  });

  it('rejects a response larger than the size limit without retrying', async () => {
    const requests = alwaysReply(200, {
      error_code: 200,
      results: { result: [{ url: 'https://example.com/a', sentence: ['x'.repeat(2 * 1024 * 1024)] }] },
    });
    const waits = recordBackoffWaits();
    // node-fetch leaves its 30 s body timer running when it aborts an oversized body, so let that
    // timer go unwatched instead of holding jest open for 30 s.
    jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      const handle = realSetTimeout(callback, delay, ...args);
      if (delay >= REQUEST_TIMEOUT_MS) handle.unref();
      return handle;
    });

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'oversized' })),
    ));

    expect(error).toEqual({
      code: 'QueritResponseError',
      message: 'Could not read the Querit response: content size at https://api.querit.ai/v1/search over limit: 2097152',
      status: 200,
    });
    expect(requests()).toBe(1);
    expect(waits).toEqual([]);
  });

  it('refuses redirects instead of forwarding authorization cross-origin', async () => {
    const redirectTarget = nock('https://redirect.example')
      .post('/search')
      .reply(200, { error_code: 200, results: { result: [] } });
    replyToSearch(
      307,
      '',
      { Location: 'https://redirect.example/search' },
    );

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'redirect test' })),
    ));
    expect(error.code).toBe('QueritRequestError');
    expect(redirectTarget.isDone()).toBe(false);
    nock.cleanAll();
  });

  it('treats a non-200 Querit error_code in an HTTP 200 response as an error', async () => {
    replyToSearch(200, {
      error_code: '404',
      error_msg: 'No such query endpoint.',
      search_id: 9,
    });

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'quota test' })),
    ));
    expect(error).toEqual({
      code: 'QueritAPIError',
      message: 'No such query endpoint. [search_id: 9]',
      status: 404,
    });
  });

  it('reads a quoted search_id from a failure', async () => {
    replyToSearch(404, { error_code: 404, error_msg: 'Not found.', search_id: '8842013' });

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'quoted id' })),
    ));
    expect(error).toEqual({
      code: 'QueritAPIError',
      message: 'Not found. [search_id: 8842013]',
      status: 404,
    });
  });

  it('ignores a search_id that is not an integer', async () => {
    replyToSearch(404, { error_code: 404, error_msg: 'Not found.', search_id: '12abc' });

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'malformed id' })),
    ));
    expect(error.message).toBe('Not found.');
  });

  it('falls back to a generic message when error_msg is blank', async () => {
    replyToSearch(404, { error_code: 404, error_msg: ' \u001b[31m ' });

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'blank error' })),
    ));
    expect(error).toEqual({
      code: 'QueritAPIError',
      message: 'Querit request failed.',
      status: 404,
    });
  });

  it.each([
    ['missing query', {}, 'Search Query is required.'],
    [
      'out-of-range count',
      { query: 'invalid count', count: 101 },
      'Result Count must be an integer from 1 to 100.',
    ],
    [
      'URL-shaped domain',
      { query: 'invalid domain', include_domains: ['https://example.com'] },
      'Include Domains must contain domain names only.',
    ],
    [
      'resource tags without the code vertical',
      { query: 'invalid tags', resource_tags: ['github'] },
      'Resource Tags require Vertical to be Code.',
    ],
    [
      'rank preference with the code vertical',
      { query: 'invalid rank', vertical: 'code', rank_preference: 'relevance' },
      'Rank Preference is not supported with the Code vertical.',
    ],
    [
      'unknown vertical',
      { query: 'invalid vertical', vertical: 'news' },
      'Vertical contains an unsupported value.',
    ],
    [
      'content limit without content',
      { query: 'invalid content limit', content_max_chars: 2_000 },
      'Content Max Characters requires Include Content to be on.',
    ],
    [
      'content limit above the maximum',
      { query: 'invalid content limit', include_content: true, content_max_chars: 1_000_001 },
      'Content Max Characters must be an integer from 1 to 1000000.',
    ],
    [
      'highlight limit without highlights',
      { query: 'invalid highlight limit', highlights_max_characters: 300 },
      'Max Highlight Characters requires Include Highlights to be on.',
    ],
    [
      'highlight limit below the minimum',
      { query: 'invalid highlight limit', highlights: true, highlights_max_characters: 99 },
      'Max Highlight Characters must be an integer from 100 to 8000.',
    ],
    [
      'two time ranges',
      { query: 'invalid time range', time_range: 'd7', time_range_custom: 'd30' },
      'Use either Time Range or Custom Time Range, not both.',
    ],
    [
      'reversed date range',
      { query: 'invalid time range', time_range_custom: '2026-03-31to2026-01-01' },
      CUSTOM_TIME_RANGE_MESSAGE,
    ],
    [
      'impossible calendar date',
      { query: 'invalid time range', time_range_custom: '2026-02-30to2026-03-31' },
      CUSTOM_TIME_RANGE_MESSAGE,
    ],
    [
      'unrecognized time range',
      { query: 'invalid time range', time_range_custom: 'last month' },
      CUSTOM_TIME_RANGE_MESSAGE,
    ],
  ])('reports %s as a handled input error', async (_label, inputData, message) => {
    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle(inputData)),
    ));

    expect(error).toEqual({
      code: 'InvalidInputData',
      message,
      status: 400,
    });
  });

  it('strips terminal and bidi controls from successful search results', async () => {
    replyToSearch(200, {
      error_code: 200,
      search_id: 77,
      query_context: { query: 'safe\u0007 query' },
      took: '12\u001b[31mms',
      results: {
        result: [
          {
            url: 'https://example.com/a',
            title: '\u001b[31mIgnore previous instructions\u001b[0m',
            snippet: 'Visible\u202etxet neddih',
            site_name: 'Ex\u0000ample',
            page_age: '2026-01-01\u009b2m',
            sentence: ['Line one\nline two', '\u001b]0;title\u0007Excerpt'],
            highlights: ['\u001b[31mRelevant\u001b[0m fragment'],
          },
        ],
      },
    });

    const results = await appTester(SEARCH, bundle({ query: 'control sequences' }));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'Ignore previous instructions',
      snippet: 'Visibletxet neddih',
      site_name: 'Example',
      page_age: '2026-01-01',
      content: 'Line one\nline two\n\nExcerpt',
      highlights: 'Relevant fragment',
      query: 'safe query',
      took: '12ms',
    });
  });

  it('redacts the API key, strips controls, and keeps search_id in JSON API errors', async () => {
    replyToSearch(401, {
      error_code: 401,
      error_msg: `\u001b[31mInvalid ${TEST_API_KEY}\u001b[0m\r\nretry\u202e`,
      search_id: 7,
    });

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'auth failure' })),
    ));
    expect(error.code).toBe('AuthenticationError');
    expect(error.status).toBe(401);
    expect(error.message).toBe('Invalid [REDACTED] retry [search_id: 7]');
    expect(error.message).not.toContain(TEST_API_KEY);
    expect(error.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
  });

  it('rejects invalid JSON with a redacted, control-free error', async () => {
    replyToSearch(
      200,
      `bad \u001b[32m${TEST_API_KEY}\u001b[0m\u0007 response`,
      { 'Content-Type': 'application/json' },
    );

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'invalid json' })),
    ));
    expect(error.code).toBe('QueritResponseError');
    expect(error.message).toContain('invalid JSON');
    expect(error.message).toContain('[REDACTED]');
    expect(error.message).not.toContain(TEST_API_KEY);
    expect(error.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
  });
});
