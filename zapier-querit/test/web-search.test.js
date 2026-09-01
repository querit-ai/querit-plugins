'use strict';

const nock = require('nock');
const zapier = require('zapier-platform-core');
const App = require('../index');

const appTester = zapier.createAppTester(App);
const TEST_API_KEY = 'unit-test-api-key-placeholder';
const SEARCH = App.searches.web_search.operation.perform;

const bundle = (inputData = {}) => ({
  authData: { apiKey: TEST_API_KEY },
  inputData,
});

const replyToSearch = (status, body, headers = { 'Content-Type': 'application/json' }) => (
  nock('https://api.querit.ai')
    .post('/v1/search')
    .reply(status, body, headers)
);

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

beforeAll(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  expect(nock.isDone()).toBe(true);
  nock.cleanAll();
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
    expect(App.searches.web_search.operation.cleanInputData).toBe(false);
    expect(App.searches.web_search.display).toEqual({
      label: 'Find Web Search Results',
      description: 'Finds live web search results.',
    });
    expect(App.triggers).toEqual({});
    expect(App.creates).toEqual({});
  });

  it('builds the documented Querit request body with optional filters', async () => {
    const expectedBody = {
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
        languages: { include: ['english', 'japanese'] },
      },
    };

    const request = nock('https://api.querit.ai', {
      reqheaders: {
        authorization: `Bearer ${TEST_API_KEY}`,
        'content-type': 'application/json',
      },
    })
      .post('/v1/search', expectedBody)
      .reply(200, { error_code: 200, results: { result: [] } });

    const result = await appTester(SEARCH, bundle({
      query: '  Node.js 22 runtime  ',
      count: '7',
      chunks_per_doc: 2,
      include_content: 'true',
      include_domains: ['Example.com', 'docs.example.com', 'example.com'],
      exclude_domains: ['noise.example'],
      time_range: 'm3',
      countries: ['United States', 'japan', 'JAPAN'],
      languages: ['English', 'japanese'],
    }));

    expect(result).toEqual([]);
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
      query: 'resolved query',
      search_id: '9007199254740993123',
      took: '0.42s',
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
      query: 'resolved query',
      search_id: '9007199254740993123',
      took: '0.42s',
    });
    expect(results).not.toHaveProperty('results');
    expect(Object.values(results[0]).every((value) => (
      typeof value === 'string' || typeof value === 'number'
    ))).toBe(true);
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

  it('handles HTTP errors without falling through to output mapping', async () => {
    replyToSearch(503, {
      error_code: 503,
      error_msg: 'Querit is temporarily unavailable.',
    });

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'service status' })),
    ));
    expect(error).toEqual({
      code: 'QueritAPIError',
      message: 'Querit is temporarily unavailable.',
      status: 503,
    });
  });

  it('preserves Zapier throttling errors for HTTP 429 responses', async () => {
    replyToSearch(
      429,
      { error_code: 429, error_msg: 'Too many searches.' },
      { 'Content-Type': 'application/json', 'Retry-After': '12' },
    );

    const error = await captureError(
      appTester(SEARCH, bundle({ query: 'throttled search' })),
    );
    expect(error.name).toBe('ThrottledError');
    expect(JSON.parse(error.message)).toEqual({
      message: 'The server returned 429 (Too Many Requests)',
      delay: 12,
    });
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
      error_code: '429',
      error_msg: 'Search quota exceeded.',
    });

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'quota test' })),
    ));
    expect(error).toEqual({
      code: 'QueritAPIError',
      message: 'Search quota exceeded.',
    });
  });

  it.each([
    ['missing query', {}, 'Search Query is required.'],
    [
      'out-of-range count',
      { query: 'invalid count', count: 21 },
      'Result Count must be an integer from 1 to 20.',
    ],
    [
      'URL-shaped domain',
      { query: 'invalid domain', include_domains: ['https://example.com'] },
      'Include Domains must contain domain names only.',
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
      query: 'safe query',
      took: '12ms',
    });
  });

  it('redacts the API key and strips controls from JSON API errors', async () => {
    replyToSearch(401, {
      error_code: 401,
      error_msg: `\u001b[31mInvalid ${TEST_API_KEY}\u001b[0m\r\nretry\u202e`,
    });

    const error = parseAppError(await captureError(
      appTester(SEARCH, bundle({ query: 'auth failure' })),
    ));
    expect(error.code).toBe('AuthenticationError');
    expect(error.status).toBe(401);
    expect(error.message).toContain('[REDACTED]');
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
