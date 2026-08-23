import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	buildContentsRequest,
	buildSearchRequest,
	extractUrlValues,
	parseContentsResponse,
	parseSearchResponse,
	queritApiRequest,
	QUERIT_COUNTRIES,
	QUERIT_LANGUAGES,
	QueritInputError,
	QueritResponseError,
	redactSecret,
	safeErrorMessage,
	type QueritContentItem,
	type QueritContentsResponse,
	type QueritSearchResponse,
	type QueritSearchResult,
} from './GenericFunctions';

export class Querit implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Querit',
		name: 'querit',
		icon: { light: 'file:querit.svg', dark: 'file:querit.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] === "search" ? "Search Web" : "Fetch Content"}}',
		description: 'Search the live web and fetch clean page content with Querit',
		documentationUrl:
			'https://github.com/querit-ai/querit-plugins/tree/main/n8n-nodes-querit#operations',
		defaults: {
			name: 'Querit',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'queritApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Fetch Content',
						value: 'fetch',
						description: 'Fetch clean page content for up to 10 URLs',
						action: 'Fetch web content',
					},
					{
						name: 'Search Web',
						value: 'search',
						description: 'Search the live web and return one item per result',
						action: 'Search web',
					},
				],
				default: 'search',
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. latest n8n releases',
				description: 'The web search query',
				typeOptions: {
					maxLength: 1000,
				},
				displayOptions: {
					show: {
						operation: ['search'],
					},
				},
			},
			{
				displayName: 'Count',
				name: 'count',
				type: 'number',
				default: 5,
				description: 'Maximum number of search results to return',
				typeOptions: {
					minValue: 1,
					maxValue: 20,
					numberStepSize: 1,
				},
				displayOptions: {
					show: {
						operation: ['search'],
					},
				},
			},
			{
				displayName: 'Search Options',
				name: 'searchOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						operation: ['search'],
					},
				},
				options: [
					{
						displayName: 'Chunks Per Result',
						name: 'chunksPerDoc',
						type: 'number',
						default: 1,
						description: 'Number of sentence-level content excerpts per result',
						typeOptions: {
							minValue: 1,
							maxValue: 3,
							numberStepSize: 1,
						},
					},
					{
						displayName: 'Countries',
						name: 'countries',
						type: 'multiOptions',
						default: [],
						description: 'Countries to use when targeting search results',
						options: [...QUERIT_COUNTRIES],
					},
					{
						displayName: 'Exclude Domains',
						name: 'excludeDomains',
						type: 'string',
						default: '',
						placeholder: 'e.g. example.com, docs.example.org',
						description: 'Comma-separated domains to exclude from search results',
					},
					{
						displayName: 'Include Content',
						name: 'includeContent',
						type: 'boolean',
						default: false,
						description: 'Whether to request sentence-level content excerpts',
					},
					{
						displayName: 'Include Domains',
						name: 'includeDomains',
						type: 'string',
						default: '',
						placeholder: 'e.g. n8n.io, github.com',
						description: 'Comma-separated domains to include in search results',
					},
					{
						displayName: 'Languages',
						name: 'languages',
						type: 'multiOptions',
						default: [],
						description: 'Languages to include in search results',
						options: [...QUERIT_LANGUAGES],
					},
					{
						displayName: 'Time Range',
						name: 'timeRange',
						type: 'string',
						default: '',
						placeholder: 'e.g. d7',
						description:
							'Relative range such as d7, w2, m3, or y1, or an inclusive YYYY-MM-DDtoYYYY-MM-DD range',
					},
				],
			},
			{
				displayName: 'URLs',
				name: 'urls',
				type: 'fixedCollection',
				required: true,
				placeholder: 'Add URL',
				default: {
					url: [],
				},
				description: 'HTTP or HTTPS pages to fetch, with a maximum of 10 URLs',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						operation: ['fetch'],
					},
				},
				options: [
					{
						displayName: 'URL',
						name: 'url',
						values: [
							{
								displayName: 'URL',
								name: 'value',
								type: 'string',
								required: true,
								default: '',
								placeholder: 'e.g. https://example.com/article',
								description: 'The HTTP or HTTPS URL to fetch',
							},
						],
					},
				],
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				options: [
					{
						name: 'HTML',
						value: 'html',
					},
					{
						name: 'Markdown',
						value: 'markdown',
					},
					{
						name: 'Text',
						value: 'text',
					},
				],
				default: 'markdown',
				description: 'Format to request for fetched page content',
				displayOptions: {
					show: {
						operation: ['fetch'],
					},
				},
			},
			{
				displayName: 'Crawl Timeout',
				name: 'crawlTimeout',
				type: 'number',
				default: 10,
				description: 'Maximum crawl time per page in seconds',
				typeOptions: {
					minValue: 1,
					maxValue: 60,
					numberStepSize: 1,
				},
				displayOptions: {
					show: {
						operation: ['fetch'],
					},
				},
			},
			{
				displayName: 'Include Metadata',
				name: 'includeMetadata',
				type: 'boolean',
				default: true,
				description: 'Whether to include page titles, publication times, and site details',
				displayOptions: {
					show: {
						operation: ['fetch'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			let apiKey = '';
			try {
				const credentials = await this.getCredentials('queritApi');
				apiKey = typeof credentials.apiKey === 'string' ? credentials.apiKey : '';
				if (!apiKey.trim()) {
					throw new NodeOperationError(
						this.getNode(),
						'The Querit API credential does not contain an API key.',
						{ itemIndex },
					);
				}

				const operation = this.getNodeParameter('operation', itemIndex) as string;
				if (operation === 'search') {
					const query = this.getNodeParameter('query', itemIndex) as string;
					const count = this.getNodeParameter('count', itemIndex) as number;
					const searchOptions = this.getNodeParameter(
						'searchOptions',
						itemIndex,
						{},
					) as IDataObject;
					const request = buildSearchRequest(query, count, searchOptions);
					const response = await queritApiRequest.call(this, '/v1/search', request, apiKey);
					const normalized = parseSearchResponse(
						response.body,
						response.statusCode,
						request.query,
						apiKey,
						request.count,
					);
					if (normalized.results.length === 0) {
						returnData.push({
							json: toEmptySearchJson(normalized),
							pairedItem: { item: itemIndex },
						});
					}
					for (const result of normalized.results) {
						returnData.push({
							json: toSearchJson(normalized, result),
							pairedItem: { item: itemIndex },
						});
					}
					continue;
				}

				if (operation === 'fetch') {
					const urls = extractUrlValues(this.getNodeParameter('urls', itemIndex));
					const format = this.getNodeParameter('format', itemIndex) as string;
					const crawlTimeout = this.getNodeParameter('crawlTimeout', itemIndex) as number;
					const includeMetadata = this.getNodeParameter('includeMetadata', itemIndex) as boolean;
					const request = buildContentsRequest(urls, format, crawlTimeout, includeMetadata);
					const response = await queritApiRequest.call(this, '/v1/contents', request, apiKey);
					const normalized = parseContentsResponse(
						response.body,
						response.statusCode,
						apiKey,
						request.extrasMeta,
					);
					if (normalized.items.length === 0) {
						returnData.push({
							json: toEmptyContentsJson(normalized, request.urls, request.format),
							pairedItem: { item: itemIndex },
						});
					}
					for (const contentItem of normalized.items) {
						returnData.push({
							json: toContentJson(normalized, contentItem, request.format),
							pairedItem: { item: itemIndex },
						});
					}
					continue;
				}

				throw new NodeOperationError(this.getNode(), "The selected 'Operation' is not supported.", {
					itemIndex,
				});
			} catch (error) {
				const nodeError = toNodeError(this, error, apiKey, itemIndex);
				if (!this.continueOnFail()) throw nodeError;

				returnData.push({
					json: {
						error: nodeError.message,
						...(nodeError.description ? { details: nodeError.description } : {}),
					},
					pairedItem: { item: itemIndex },
				});
			}
		}

		return [returnData];
	}
}

function toEmptySearchJson(response: QueritSearchResponse): IDataObject {
	return {
		query: response.query,
		results: [],
		...(response.searchId === undefined ? {} : { searchId: response.searchId }),
		...(response.took === undefined ? {} : { took: response.took }),
	};
}

function toSearchJson(response: QueritSearchResponse, result: QueritSearchResult): IDataObject {
	return {
		query: response.query,
		title: result.title,
		url: result.url,
		snippet: result.snippet,
		sentences: result.sentences,
		...(result.pageAge === undefined ? {} : { pageAge: result.pageAge }),
		...(result.siteName === undefined ? {} : { siteName: result.siteName }),
		...(result.siteIcon === undefined ? {} : { siteIcon: result.siteIcon }),
		...(response.searchId === undefined ? {} : { searchId: response.searchId }),
		...(response.took === undefined ? {} : { took: response.took }),
	};
}

function toEmptyContentsJson(
	response: QueritContentsResponse,
	urls: string[],
	format: string,
): IDataObject {
	return {
		urls,
		items: [],
		format,
		...(response.searchId === undefined ? {} : { searchId: response.searchId }),
		...(response.searchTime === undefined ? {} : { searchTime: response.searchTime }),
	};
}

function toContentJson(
	response: QueritContentsResponse,
	item: QueritContentItem,
	format: string,
): IDataObject {
	return {
		format,
		...(item.id === undefined ? {} : { id: item.id }),
		...(item.url === undefined ? {} : { url: item.url }),
		...(item.content === undefined ? {} : { content: item.content }),
		...(item.status === undefined ? {} : { status: item.status }),
		...(item.metadata === undefined ? {} : { metadata: { ...item.metadata } }),
		...(response.searchId === undefined ? {} : { searchId: response.searchId }),
		...(response.searchTime === undefined ? {} : { searchTime: response.searchTime }),
	};
}

function toNodeError(
	context: IExecuteFunctions,
	error: unknown,
	apiKey: string,
	itemIndex: number,
): NodeApiError | NodeOperationError {
	const message = safeErrorMessage(error, apiKey) || 'Querit could not process this item.';
	if (error instanceof QueritResponseError || error instanceof NodeApiError) {
		const responseError = error instanceof QueritResponseError ? error : undefined;
		const existingHttpCode = error instanceof NodeApiError ? error.httpCode : null;
		const statusCode = responseError?.statusCode ?? parseHttpCode(existingHttpCode);
		const safeMessage = redactSecret(message, apiKey);
		const errorResponse: JsonObject = {
			message: safeMessage,
			...(statusCode === undefined ? {} : { statusCode }),
			...(responseError?.errorCode === undefined ? {} : { error_code: responseError.errorCode }),
			...(responseError?.searchId === undefined ? {} : { search_id: responseError.searchId }),
		};
		const identifiers = [
			responseError?.errorCode === undefined ? undefined : `Querit code ${responseError.errorCode}`,
			responseError?.searchId === undefined ? undefined : `search ID ${responseError.searchId}`,
		].filter((value): value is string => value !== undefined);
		const description =
			identifiers.length > 0
				? `${identifiers.join(', ')}. Check the node inputs and credentials, then try again.`
				: 'Check the node inputs and credentials, then try again.';

		return new NodeApiError(context.getNode(), errorResponse, {
			message: safeMessage,
			description,
			...(statusCode === undefined ? {} : { httpCode: String(statusCode) }),
			itemIndex,
		});
	}

	const description =
		error instanceof QueritInputError
			? 'Update the highlighted node parameter and try again.'
			: error instanceof NodeOperationError && error.description
				? redactSecret(error.description, apiKey)
				: 'Check the node configuration and try again.';
	return new NodeOperationError(context.getNode(), new Error(message), {
		description,
		itemIndex,
	});
}

function parseHttpCode(value: string | null): number | undefined {
	if (value === null) return undefined;
	const statusCode = Number(value);
	return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
		? statusCode
		: undefined;
}
