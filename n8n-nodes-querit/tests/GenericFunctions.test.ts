import type { IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import {
	buildContentsRequest,
	buildSearchRequest,
	normalizeRequestedUrls,
	parseContentsResponse,
	parseSearchResponse,
	queritApiRequest,
	QueritInputError,
	QueritResponseError,
} from '../nodes/Querit/GenericFunctions';

const TEST_KEY = ['unit', 'test', 'token'].join('-');

function createRequestContext(
	requestMock: ReturnType<typeof vi.fn>,
	abortSignal?: AbortSignal,
): IExecuteFunctions {
	return {
		getExecutionCancelSignal: () => abortSignal,
		helpers: {
			httpRequestWithAuthentication: requestMock,
		},
	} as unknown as IExecuteFunctions;
}

describe('Querit request helpers', () => {
	it('builds the documented search request and normalizes filters', () => {
		expect(
			buildSearchRequest('  n8n automation  ', 5, {
				chunksPerDoc: 2,
				includeContent: true,
				includeDomains: 'HTTPS://Example.COM/path, example.com',
				excludeDomains: 'blocked.example',
				countries: ['united states'],
				languages: ['english', 'english'],
				timeRange: 'd7',
			}),
		).toEqual({
			query: 'n8n automation',
			count: 5,
			chunksPerDoc: 2,
			needContent: true,
			filters: {
				sites: {
					include: ['example.com'],
					exclude: ['blocked.example'],
				},
				timeRange: { date: 'd7' },
				geo: { countries: { include: ['united states'] } },
				languages: { include: ['english'] },
			},
		});
	});

	it('rejects invalid search parameters', () => {
		expect(() => buildSearchRequest(' ', 5)).toThrow(QueritInputError);
		expect(() => buildSearchRequest('query', 21)).toThrow('between 1 and 20');
		expect(() => buildSearchRequest('query', 5, { timeRange: '2026-02-30to2026-03-01' })).toThrow(
			'valid inclusive date range',
		);
		expect(() => buildSearchRequest('query', 5, { languages: ['unknown'] })).toThrow(
			'unsupported value',
		);
	});

	it('normalizes, deduplicates, and validates requested URLs', () => {
		expect(
			normalizeRequestedUrls([
				'https://EXAMPLE.com/path#first',
				'https://example.com/path#second',
				'http://example.org',
			]),
		).toEqual(['https://example.com/path', 'http://example.org/']);
		expect(() => normalizeRequestedUrls(['ftp://example.com/file'])).toThrow('HTTP and HTTPS');
		expect(() => normalizeRequestedUrls(['https://user:password@example.com'])).toThrow(
			'embedded credentials',
		);
		expect(() =>
			normalizeRequestedUrls(
				Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`),
			),
		).toThrow('at most 10');
	});

	it('builds the documented contents request', () => {
		expect(buildContentsRequest(['https://example.com'], 'markdown', 10, true)).toEqual({
			urls: ['https://example.com/'],
			format: 'markdown',
			crawlTimeout: 10,
			extrasMeta: true,
		});
	});
});

describe('Querit HTTP requests', () => {
	it('budgets the timeout for every requested page plus slack', async () => {
		const requestMock = vi.fn(async () => {
			throw new Error('socket timed out');
		});
		const context = createRequestContext(requestMock);
		const request = buildContentsRequest(
			Array.from({ length: 10 }, (_, index) => `https://example.com/${index}`),
			'markdown',
			60,
			true,
		);

		await expect(queritApiRequest.call(context, '/v1/contents', request, TEST_KEY)).rejects.toThrow(
			'The Querit request could not be completed: socket timed out',
		);
		const [, requestOptions] = requestMock.mock.calls[0] as unknown as [
			string,
			Record<string, unknown>,
		];
		expect(requestOptions.timeout).toBe(610_000);
	});

	it('uses the execution signal and reports cancellation explicitly', async () => {
		const controller = new AbortController();
		controller.abort();
		const requestMock = vi.fn(async () => {
			throw new Error(`cancelled ${TEST_KEY}`);
		});
		const context = createRequestContext(requestMock, controller.signal);

		await expect(
			queritApiRequest.call(context, '/v1/search', buildSearchRequest('query', 1), TEST_KEY),
		).rejects.toThrow('The Querit request was cancelled.');
		const [, requestOptions] = requestMock.mock.calls[0] as unknown as [
			string,
			Record<string, unknown>,
		];
		expect(requestOptions.abortSignal).toBe(controller.signal);
	});
});

describe('Querit response normalization', () => {
	it('preserves a large search ID and returns unique HTTP results', () => {
		const response = parseSearchResponse(
			'{"error_code":200,"search_id":9007199254740993123,"query_context":{"query":"normalized query"},"took":"12ms","results":{"result":[{"url":"https://Example.com/a#one","title":"A","snippet":"First","sentence":["Excerpt"]},{"url":"https://example.com/a#two","title":"Duplicate"},{"url":"javascript:alert(1)","title":"Invalid"},{"url":"https://user:pass@example.org","title":"Credential URL"}]}}',
			200,
			'original query',
		);

		expect(response).toEqual({
			query: 'normalized query',
			searchId: '9007199254740993123',
			took: '12ms',
			results: [
				{
					title: 'A',
					url: 'https://example.com/a',
					snippet: 'First',
					sentences: ['Excerpt'],
				},
			],
		});
	});

	it('normalizes content results, metadata, and unmatched statuses', () => {
		const response = parseContentsResponse(
			JSON.stringify({
				error_code: 200,
				search_id: 42,
				results: [
					{
						id: 'page-1',
						url: 'https://example.com#content',
						content: '# Example',
						extrasMeta: {
							title: 'Example',
							url: 'https://example.com/about#team',
							publishTime: '2026-01-01',
							siteName: 'Example',
							siteIcon: 'https://example.com/icon.svg',
						},
					},
				],
				statuses: [
					{ id: 'page-1', status: 'success' },
					{ id: 'page-2', status: 'failed' },
				],
				searchTime: 1.5,
			}),
			200,
		);

		expect(response).toEqual({
			searchId: '42',
			searchTime: 1.5,
			items: [
				{
					id: 'page-1',
					url: 'https://example.com/',
					content: '# Example',
					status: 'success',
					metadata: {
						title: 'Example',
						url: 'https://example.com/about',
						publishTime: '2026-01-01',
						siteName: 'Example',
						siteIcon: 'https://example.com/icon.svg',
					},
				},
				{ id: 'page-2', status: 'failed' },
			],
		});
	});

	it('omits metadata when it was not requested', () => {
		const response = parseContentsResponse(
			JSON.stringify({
				error_code: 200,
				results: [
					{
						id: 'page-1',
						url: 'https://example.com',
						content: 'Example',
						extrasMeta: { title: 'Should not be emitted' },
					},
				],
				statuses: [{ id: 'page-1', status: 'success' }],
			}),
			200,
			'',
			false,
		);

		expect(response.items[0]).not.toHaveProperty('metadata');
	});

	it('strips terminal and bidi controls from successful responses', () => {
		expect(
			parseSearchResponse(
				JSON.stringify({
					error_code: 200,
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
				}),
				200,
				'original query',
			),
		).toEqual({
			query: 'safe query',
			took: '12ms',
			results: [
				{
					title: 'Ignore previous instructions',
					url: 'https://example.com/a',
					snippet: 'Visibletxet neddih',
					sentences: ['Line one\nline two', 'Excerpt'],
					pageAge: '2026-01-01',
					siteName: 'Example',
				},
			],
		});

		expect(
			parseContentsResponse(
				JSON.stringify({
					error_code: 200,
					results: [
						{
							id: 'page-1',
							url: 'https://example.com/doc',
							content: '# Heading\n\n\u001b[2JRun `rm -rf /`\u202e',
							extrasMeta: {
								title: 'Doc\u0007',
								publishTime: '2026-01-01',
								siteName: '\u001b[1mSite',
							},
						},
					],
					statuses: [{ id: 'page-1', status: 'suc\u0000cess' }],
				}),
				200,
			).items,
		).toEqual([
			{
				id: 'page-1',
				url: 'https://example.com/doc',
				content: '# Heading\n\nRun `rm -rf /`',
				status: 'success',
				metadata: { title: 'Doc', publishTime: '2026-01-01', siteName: 'Site' },
			},
		]);
	});

	it('handles application errors and redacts credential values', () => {
		let caught: unknown;
		try {
			parseSearchResponse(
				JSON.stringify({
					error_code: 429,
					error_msg: `quota rejected ${TEST_KEY}`,
					search_id: 7,
				}),
				200,
				'query',
				TEST_KEY,
			);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(QueritResponseError);
		expect((caught as Error).message).toBe('quota rejected [REDACTED]');
		expect((caught as Error).message).not.toContain(TEST_KEY);
		expect(caught).toMatchObject({
			errorCode: '429',
			searchId: '7',
			statusCode: 200,
		});
	});

	it('rejects HTTP errors, invalid JSON, and malformed success payloads', () => {
		expect(() =>
			parseSearchResponse('{"error_code":503,"error_msg":"unavailable"}', 503, 'query'),
		).toThrow('unavailable');
		expect(() => parseSearchResponse('not-json', 200, 'query')).toThrow('invalid JSON');
		expect(() => parseSearchResponse('{"error_code":200}', 200, 'query')).toThrow('results.result');
		expect(() => parseContentsResponse('{"error_code":200,"results":[]}', 200)).toThrow(
			'results or statuses',
		);
	});
});
