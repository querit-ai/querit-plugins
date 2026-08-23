import type { IExecuteFunctions, IN8nHttpFullResponse, INode } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { QueritApi } from '../credentials/QueritApi.credentials';
import { Querit } from '../nodes/Querit/Querit.node';

const TEST_KEY = ['unit', 'test', 'token'].join('-');
const TEST_NODE: INode = {
	id: 'querit-test-node',
	name: 'Querit',
	type: 'n8n-nodes-querit.querit',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function httpResponse(body: string, statusCode = 200): IN8nHttpFullResponse {
	return {
		body,
		headers: {},
		statusCode,
	};
}

function createContext(
	parameters: Record<string, unknown> | Array<Record<string, unknown>>,
	responses: IN8nHttpFullResponse[],
	continueOnFail = false,
): {
	context: IExecuteFunctions;
	requestMock: ReturnType<typeof vi.fn>;
} {
	const parametersByItem: Array<Record<string, unknown>> = Array.isArray(parameters)
		? parameters
		: [parameters];
	const pendingResponses = [...responses];
	const requestMock = vi.fn(async () => {
		const response = pendingResponses.shift();
		if (response === undefined) throw new Error('No mock response configured');
		return response;
	});
	const context = {
		getInputData: () => parametersByItem.map(() => ({ json: {} })),
		getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) =>
			parametersByItem[itemIndex]?.[name] ?? fallback,
		getCredentials: async () => ({ apiKey: TEST_KEY }),
		getNode: () => TEST_NODE,
		getExecutionCancelSignal: () => undefined,
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: requestMock,
		},
	} as unknown as IExecuteFunctions;
	return { context, requestMock };
}

describe('Querit node metadata and credentials', () => {
	it('is usable as an AI tool and declares both operations', () => {
		const node = new Querit();
		expect(node.description.usableAsTool).toBe(true);
		expect(node.description.version).toBe(1);
		const operation = node.description.properties.find((property) => property.name === 'operation');
		expect(operation?.options).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'Search Web', value: 'search' }),
				expect.objectContaining({ name: 'Fetch Content', value: 'fetch' }),
			]),
		);
	});

	it('stores the API key as a password and tests it with an authenticated POST search', () => {
		const credential = new QueritApi();
		expect(credential.properties[0]).toMatchObject({
			name: 'apiKey',
			typeOptions: { password: true },
		});
		expect(credential.authenticate.properties).toMatchObject({
			headers: { Authorization: '=Bearer {{$credentials.apiKey}}' },
		});
		expect(credential.test.request).toMatchObject({
			baseURL: 'https://api.querit.ai',
			url: '/v1/search',
			method: 'POST',
			body: { query: 'n8n credential test', count: 1 },
			allowedDomains: 'api.querit.ai',
			sendCredentialsOnCrossOriginRedirect: false,
		});
		expect(credential.supportedNodes).toEqual(['n8n-nodes-querit.querit']);
	});

	it('fails credential tests on authentication errors, not success or rate limits', () => {
		const credential = new QueritApi();
		const failureValues = (credential.test.rules ?? []).map((rule) => rule.properties.value);

		expect(failureValues).toEqual([401, '401', 403, '403']);
		expect(failureValues).not.toContain(200);
		expect(failureValues).not.toContain('200');
		expect(failureValues).not.toContain(429);
		expect(failureValues).not.toContain('429');
	});
});

describe('Querit node execution', () => {
	it('flattens unique search results and preserves search ID and pairing', async () => {
		const { context, requestMock } = createContext(
			{
				operation: 'search',
				query: 'n8n community nodes',
				count: 5,
				searchOptions: { includeContent: true, chunksPerDoc: 1 },
			},
			[
				httpResponse(
					'{"error_code":200,"search_id":9007199254740993123,"results":{"result":[{"url":"https://example.com/a","title":"A","snippet":"One","sentence":["Excerpt"]},{"url":"https://example.com/a#duplicate","title":"Duplicate"}]}}',
				),
			],
		);

		const result = await new Querit().execute.call(context);

		expect(result).toEqual([
			[
				{
					json: {
						query: 'n8n community nodes',
						title: 'A',
						url: 'https://example.com/a',
						snippet: 'One',
						sentences: ['Excerpt'],
						searchId: '9007199254740993123',
					},
					pairedItem: { item: 0 },
				},
			],
		]);
		expect(requestMock).toHaveBeenCalledOnce();
		const [credentialType, requestOptions] = requestMock.mock.calls[0] as [
			string,
			Record<string, unknown>,
		];
		expect(credentialType).toBe('queritApi');
		expect(requestOptions).toMatchObject({
			method: 'POST',
			url: 'https://api.querit.ai/v1/search',
			allowedDomains: 'api.querit.ai',
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		});
		expect(JSON.parse(requestOptions.body as string)).toEqual({
			query: 'n8n community nodes',
			count: 5,
			chunksPerDoc: 1,
			needContent: true,
		});
	});

	it('flattens fetched content and unmatched statuses with pairing', async () => {
		const { context } = createContext(
			{
				operation: 'fetch',
				urls: {
					url: [{ value: 'https://example.com' }],
				},
				format: 'markdown',
				crawlTimeout: 10,
				includeMetadata: true,
			},
			[
				httpResponse(
					JSON.stringify({
						error_code: 200,
						search_id: 8,
						results: [
							{
								id: 'one',
								url: 'https://example.com',
								content: '# Example',
								extrasMeta: { title: 'Example' },
							},
						],
						statuses: [
							{ id: 'one', status: 'success' },
							{ id: 'two', status: 'failed' },
						],
						searchTime: 0.5,
					}),
				),
			],
		);

		const result = await new Querit().execute.call(context);

		expect(result[0]).toEqual([
			{
				json: {
					format: 'markdown',
					id: 'one',
					url: 'https://example.com/',
					content: '# Example',
					status: 'success',
					metadata: { title: 'Example' },
					searchId: '8',
					searchTime: 0.5,
				},
				pairedItem: { item: 0 },
			},
			{
				json: {
					format: 'markdown',
					id: 'two',
					status: 'failed',
					searchId: '8',
					searchTime: 0.5,
				},
				pairedItem: { item: 0 },
			},
		]);
	});

	it('preserves pairing when multiple successful inputs normalize to no rows', async () => {
		const { context } = createContext(
			[
				{
					operation: 'search',
					query: 'empty search',
					count: 2,
					searchOptions: {},
				},
				{
					operation: 'fetch',
					urls: { url: [{ value: 'https://example.com' }] },
					format: 'text',
					crawlTimeout: 10,
					includeMetadata: false,
				},
			],
			[
				httpResponse(
					JSON.stringify({
						error_code: 200,
						search_id: 10,
						results: {
							result: [
								{ url: 'javascript:alert(1)' },
								{ url: 'https://user:password@example.com' },
							],
						},
					}),
				),
				httpResponse(
					JSON.stringify({
						error_code: 200,
						search_id: 11,
						results: [{ id: 'bad', url: 'file:///private.txt', content: 'ignored' }],
						statuses: [],
						searchTime: 0.2,
					}),
				),
			],
		);

		const result = await new Querit().execute.call(context);

		expect(result[0]).toEqual([
			{
				json: {
					query: 'empty search',
					results: [],
					searchId: '10',
				},
				pairedItem: { item: 0 },
			},
			{
				json: {
					urls: ['https://example.com/'],
					items: [],
					format: 'text',
					searchId: '11',
					searchTime: 0.2,
				},
				pairedItem: { item: 1 },
			},
		]);
	});

	it('returns a paired validation item when continue on fail is enabled', async () => {
		const { context, requestMock } = createContext(
			{
				operation: 'fetch',
				urls: { url: [{ value: 'file:///private.txt' }] },
				format: 'text',
				crawlTimeout: 10,
				includeMetadata: false,
			},
			[],
			true,
		);

		const result = await new Querit().execute.call(context);

		expect(result[0]?.[0]).toMatchObject({
			json: {
				error: "Only HTTP and HTTPS URLs are allowed in the 'URLs' parameter.",
			},
			pairedItem: { item: 0 },
		});
		expect(requestMock).not.toHaveBeenCalled();
	});

	it('returns a paired NodeApiError item when continue on fail is enabled', async () => {
		const { context } = createContext(
			{
				operation: 'search',
				query: 'query',
				count: 1,
				searchOptions: {},
			},
			[
				httpResponse(
					JSON.stringify({
						error_code: 401,
						error_msg: `credential ${TEST_KEY} rejected`,
						search_id: 9,
					}),
				),
			],
			true,
		);

		const result = await new Querit().execute.call(context);

		expect(result[0]?.[0]).toMatchObject({
			json: {
				error: 'credential [REDACTED] rejected',
				details:
					'Querit code 401, search ID 9. Check the node inputs and credentials, then try again.',
			},
			pairedItem: { item: 0 },
		});
		expect(JSON.stringify(result)).not.toContain(TEST_KEY);
	});

	it('throws a redacted NodeApiError for an application-level error', async () => {
		const { context } = createContext(
			{
				operation: 'search',
				query: 'query',
				count: 1,
				searchOptions: {},
			},
			[
				httpResponse(
					JSON.stringify({
						error_code: 401,
						error_msg: `credential ${TEST_KEY} rejected`,
						search_id: 9,
					}),
				),
			],
		);

		let caught: unknown;
		try {
			await new Querit().execute.call(context);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(NodeApiError);
		expect((caught as Error).message).toBe('credential [REDACTED] rejected');
		expect((caught as Error).message).not.toContain(TEST_KEY);
		expect(caught).toMatchObject({
			context: { itemIndex: 0 },
		});
	});
});
