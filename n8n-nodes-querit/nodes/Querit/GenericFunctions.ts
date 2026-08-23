import type { IExecuteFunctions, IN8nHttpFullResponse } from 'n8n-workflow';

export const QUERIT_API_BASE_URL = 'https://api.querit.ai';

export const QUERIT_COUNTRIES = [
	{ name: 'Argentina', value: 'argentina' },
	{ name: 'Australia', value: 'australia' },
	{ name: 'Brazil', value: 'brazil' },
	{ name: 'Canada', value: 'canada' },
	{ name: 'Colombia', value: 'colombia' },
	{ name: 'France', value: 'france' },
	{ name: 'Germany', value: 'germany' },
	{ name: 'India', value: 'india' },
	{ name: 'Indonesia', value: 'indonesia' },
	{ name: 'Japan', value: 'japan' },
	{ name: 'Mexico', value: 'mexico' },
	{ name: 'Nigeria', value: 'nigeria' },
	{ name: 'Philippines', value: 'philippines' },
	{ name: 'South Korea', value: 'south korea' },
	{ name: 'Spain', value: 'spain' },
	{ name: 'United Kingdom', value: 'united kingdom' },
	{ name: 'United States', value: 'united states' },
] as const;

export const QUERIT_LANGUAGES = [
	{ name: 'English', value: 'english' },
	{ name: 'French', value: 'french' },
	{ name: 'German', value: 'german' },
	{ name: 'Japanese', value: 'japanese' },
	{ name: 'Korean', value: 'korean' },
	{ name: 'Portuguese', value: 'portuguese' },
	{ name: 'Spanish', value: 'spanish' },
] as const;

const SEARCH_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const CONTENTS_RESPONSE_MAX_BYTES = 10 * 1024 * 1024;
const ERROR_RESPONSE_MAX_BYTES = 8 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 70_000;
const CONTENTS_REQUEST_TIMEOUT_SLACK_MS = 10_000;
const TIME_RANGE_PATTERN = /^(?:[dwmy][1-9][0-9]*|\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2})$/u;

export type QueritContentFormat = 'html' | 'markdown' | 'text';

export interface QueritSearchRequest {
	query: string;
	count: number;
	chunksPerDoc: number;
	needContent: boolean;
	filters?: {
		sites?: { include?: string[]; exclude?: string[] };
		timeRange?: { date: string };
		geo?: { countries: { include: string[] } };
		languages?: { include: string[] };
	};
}

export interface QueritContentsRequest {
	urls: string[];
	format: QueritContentFormat;
	crawlTimeout: number;
	extrasMeta: boolean;
}

export interface QueritSearchResult {
	title: string;
	url: string;
	snippet: string;
	sentences: string[];
	pageAge?: string;
	siteName?: string;
	siteIcon?: string;
}

export interface QueritSearchResponse {
	query: string;
	results: QueritSearchResult[];
	searchId?: string;
	took?: string;
}

export interface QueritContentMetadata {
	title?: string;
	url?: string;
	publishTime?: string;
	siteName?: string;
	siteIcon?: string;
}

export interface QueritContentItem {
	id?: string;
	url?: string;
	content?: string;
	status?: string;
	metadata?: QueritContentMetadata;
}

export interface QueritContentsResponse {
	items: QueritContentItem[];
	searchId?: string;
	searchTime?: number;
}

export interface QueritHttpResponse {
	body: unknown;
	statusCode: number;
}

export class QueritInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'QueritInputError';
	}
}

export class QueritResponseError extends Error {
	readonly statusCode?: number;
	readonly errorCode?: string;
	readonly searchId?: string;

	constructor(
		message: string,
		options: { statusCode?: number; errorCode?: string; searchId?: string } = {},
	) {
		super(message);
		this.name = 'QueritResponseError';
		this.statusCode = options.statusCode;
		this.errorCode = options.errorCode;
		this.searchId = options.searchId;
	}
}

export function buildSearchRequest(
	queryValue: string,
	countValue: number,
	options: Record<string, unknown> = {},
): QueritSearchRequest {
	const query = queryValue.trim();
	if (!query) {
		throw new QueritInputError("The 'Query' parameter cannot be empty.");
	}
	if (query.length > 1_000) {
		throw new QueritInputError("The 'Query' parameter cannot exceed 1,000 characters.");
	}

	const count = requiredInteger(countValue, 1, 20, 'Count');
	const chunksPerDoc = optionalInteger(options.chunksPerDoc, 1, 1, 3, 'Chunks Per Result');
	const needContent = optionalBoolean(options.includeContent, false, 'Include Content');
	const includeDomains = normalizeDomains(options.includeDomains, 'Include Domains');
	const excludeDomains = normalizeDomains(options.excludeDomains, 'Exclude Domains');
	const countries = normalizeEnumValues(
		options.countries,
		new Set(QUERIT_COUNTRIES.map(({ value }) => value)),
		'Countries',
	);
	const languages = normalizeEnumValues(
		options.languages,
		new Set(QUERIT_LANGUAGES.map(({ value }) => value)),
		'Languages',
	);
	const timeRange = normalizeTimeRange(options.timeRange);

	const filters: NonNullable<QueritSearchRequest['filters']> = {};
	if (includeDomains.length > 0 || excludeDomains.length > 0) {
		filters.sites = {
			...(includeDomains.length > 0 ? { include: includeDomains } : {}),
			...(excludeDomains.length > 0 ? { exclude: excludeDomains } : {}),
		};
	}
	if (timeRange !== undefined) filters.timeRange = { date: timeRange };
	if (countries.length > 0) filters.geo = { countries: { include: countries } };
	if (languages.length > 0) filters.languages = { include: languages };

	return {
		query,
		count,
		chunksPerDoc,
		needContent,
		...(Object.keys(filters).length > 0 ? { filters } : {}),
	};
}

export function extractUrlValues(value: unknown): string[] {
	if (!isRecord(value) || !Array.isArray(value.url)) return [];

	const urls: string[] = [];
	for (const entry of value.url) {
		if (typeof entry === 'string') {
			urls.push(entry);
		} else if (isRecord(entry) && typeof entry.value === 'string') {
			urls.push(entry.value);
		}
	}
	return urls;
}

export function normalizeRequestedUrls(values: readonly string[]): string[] {
	if (values.length === 0) {
		throw new QueritInputError("Add at least one entry to the 'URLs' parameter.");
	}
	if (values.length > 10) {
		throw new QueritInputError("The 'URLs' parameter accepts at most 10 URLs.");
	}

	const normalized = new Set<string>();
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || trimmed.length > 4_096) {
			throw new QueritInputError("Every entry in the 'URLs' parameter must be a valid URL.");
		}

		let url: URL | undefined;
		try {
			url = new URL(trimmed);
		} catch {
			url = undefined;
		}
		if (url === undefined) {
			throw new QueritInputError("Every entry in the 'URLs' parameter must be a valid URL.");
		}

		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new QueritInputError("Only HTTP and HTTPS URLs are allowed in the 'URLs' parameter.");
		}
		if (url.username || url.password) {
			throw new QueritInputError('URLs containing embedded credentials are not allowed.');
		}

		url.hash = '';
		normalized.add(url.toString());
	}

	return [...normalized];
}

export function buildContentsRequest(
	urlValues: readonly string[],
	formatValue: string,
	crawlTimeoutValue: number,
	includeMetadataValue: boolean,
): QueritContentsRequest {
	if (formatValue !== 'html' && formatValue !== 'markdown' && formatValue !== 'text') {
		throw new QueritInputError("The 'Format' parameter must be HTML, Markdown, or Text.");
	}

	return {
		urls: normalizeRequestedUrls(urlValues),
		format: formatValue,
		crawlTimeout: requiredInteger(crawlTimeoutValue, 1, 60, 'Crawl Timeout'),
		extrasMeta: optionalBoolean(includeMetadataValue, true, 'Include Metadata'),
	};
}

export async function queritApiRequest(
	this: IExecuteFunctions,
	path: '/v1/contents' | '/v1/search',
	body: QueritContentsRequest | QueritSearchRequest,
	apiKey: string,
): Promise<QueritHttpResponse> {
	let response: IN8nHttpFullResponse | undefined;
	let requestError: unknown;
	let requestFailed = false;
	try {
		const abortSignal = this.getExecutionCancelSignal();
		const timeout =
			path === '/v1/contents' && 'crawlTimeout' in body
				? Math.max(
						DEFAULT_REQUEST_TIMEOUT_MS,
						body.urls.length * body.crawlTimeout * 1_000 + CONTENTS_REQUEST_TIMEOUT_SLACK_MS,
					)
				: DEFAULT_REQUEST_TIMEOUT_MS;
		response = (await this.helpers.httpRequestWithAuthentication.call(this, 'queritApi', {
			method: 'POST',
			url: `${QUERIT_API_BASE_URL}${path}`,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
			encoding: 'text',
			json: false,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			timeout,
			sendCredentialsOnCrossOriginRedirect: false,
			allowedDomains: 'api.querit.ai',
			...(abortSignal === undefined ? {} : { abortSignal }),
		})) as IN8nHttpFullResponse;
	} catch (error) {
		requestFailed = true;
		requestError = error;
	}

	if (requestFailed) {
		if (requestError instanceof QueritResponseError) throw requestError;
		const statusCode = extractHttpStatus(requestError);
		const cancelled = this.getExecutionCancelSignal()?.aborted === true;
		const message = cancelled
			? 'The Querit request was cancelled.'
			: `The Querit request could not be completed: ${safeErrorMessage(requestError, apiKey)}`;
		throw new QueritResponseError(message, { statusCode });
	}
	if (!isRecord(response) || typeof response.statusCode !== 'number' || !('body' in response)) {
		throw new QueritResponseError('Querit returned an invalid HTTP response.');
	}

	return { body: response.body, statusCode: response.statusCode };
}

export function parseSearchResponse(
	body: unknown,
	statusCode: number,
	requestedQuery: string,
	apiKey = '',
	maxResults = 20,
): QueritSearchResponse {
	const { payload, searchId } = parseEnvelope(body, statusCode, apiKey, SEARCH_RESPONSE_MAX_BYTES);
	const resultsContainer = payload.results;
	if (!isRecord(resultsContainer) || !Array.isArray(resultsContainer.result)) {
		throw new QueritResponseError('Querit search response is missing results.result.', {
			statusCode,
			searchId,
		});
	}

	const deduplicated = new Map<string, QueritSearchResult>();
	for (const rawItem of resultsContainer.result) {
		if (!isRecord(rawItem)) continue;
		const url = normalizeHttpUrl(rawItem.url);
		if (url === undefined || deduplicated.has(url)) continue;

		const result: QueritSearchResult = {
			title: sanitizedString(rawItem.title) ?? url,
			url,
			snippet: sanitizedString(rawItem.snippet) ?? '',
			sentences: Array.isArray(rawItem.sentence)
				? rawItem.sentence
						.filter((entry): entry is string => typeof entry === 'string')
						.map((entry) => sanitizeUntrustedText(entry))
				: [],
		};
		assignIfDefined(result, 'pageAge', sanitizedString(rawItem.page_age));
		assignIfDefined(result, 'siteName', sanitizedString(rawItem.site_name));
		assignIfDefined(result, 'siteIcon', normalizeHttpUrl(rawItem.site_icon));
		deduplicated.set(url, result);
		if (deduplicated.size >= maxResults) break;
	}

	const queryContext = isRecord(payload.query_context) ? payload.query_context : undefined;
	const response: QueritSearchResponse = {
		query: queryContext ? (sanitizedString(queryContext.query) ?? requestedQuery) : requestedQuery,
		results: [...deduplicated.values()],
	};
	assignIfDefined(response, 'searchId', searchId);
	assignIfDefined(response, 'took', sanitizedString(payload.took));
	return response;
}

export function parseContentsResponse(
	body: unknown,
	statusCode: number,
	apiKey = '',
	includeMetadata = true,
): QueritContentsResponse {
	const { payload, searchId } = parseEnvelope(
		body,
		statusCode,
		apiKey,
		CONTENTS_RESPONSE_MAX_BYTES,
	);
	if (!Array.isArray(payload.results) || !Array.isArray(payload.statuses)) {
		throw new QueritResponseError('Querit contents response is missing results or statuses.', {
			statusCode,
			searchId,
		});
	}

	const statuses = payload.statuses.filter(isRecord).map((status) => ({
		id: sanitizedString(status.id),
		status: sanitizedString(status.status),
	}));
	const claimedStatuses = new Set<number>();
	const seenUrls = new Set<string>();
	const items: QueritContentItem[] = [];

	for (const rawResult of payload.results) {
		if (!isRecord(rawResult)) continue;
		const url = normalizeHttpUrl(rawResult.url);
		if (url === undefined || seenUrls.has(url)) continue;
		seenUrls.add(url);

		const id = sanitizedString(rawResult.id);
		const statusIndex = statuses.findIndex(
			(status, index) => !claimedStatuses.has(index) && id !== undefined && status.id === id,
		);
		if (statusIndex >= 0) claimedStatuses.add(statusIndex);

		const item: QueritContentItem = {
			url,
			content:
				typeof rawResult.content === 'string' ? sanitizeUntrustedText(rawResult.content) : '',
		};
		assignIfDefined(item, 'id', id);
		assignIfDefined(item, 'status', statusIndex >= 0 ? statuses[statusIndex]?.status : undefined);

		const metadata = includeMetadata ? normalizeMetadata(rawResult.extrasMeta) : undefined;
		if (metadata !== undefined) item.metadata = metadata;
		items.push(item);
	}

	for (const [index, status] of statuses.entries()) {
		if (claimedStatuses.has(index)) continue;
		const item: QueritContentItem = {};
		assignIfDefined(item, 'id', status.id);
		assignIfDefined(item, 'status', status.status);
		items.push(item);
	}

	const response: QueritContentsResponse = { items };
	assignIfDefined(response, 'searchId', searchId);
	assignIfDefined(response, 'searchTime', optionalNumber(payload.searchTime));
	return response;
}

export function redactSecret(value: string, secret: string): string {
	let redacted = value;
	const candidates = new Set([secret, secret.trim()]);
	for (const candidate of candidates) {
		if (candidate) redacted = redacted.split(candidate).join('[REDACTED]');
	}
	return sanitizeUntrustedText(redacted);
}

export function safeErrorMessage(error: unknown, secret: string): string {
	const message = error instanceof Error ? error.message : String(error);
	return redactSecret(message, secret).replace(/\s+/gu, ' ').trim().slice(0, 1_000);
}

interface ParsedEnvelope {
	payload: Record<string, unknown>;
	searchId?: string;
}

function parseEnvelope(
	body: unknown,
	statusCode: number,
	apiKey: string,
	successResponseMaxBytes: number,
): ParsedEnvelope {
	const text = responseBodyToText(body);
	const maxBytes =
		statusCode >= 200 && statusCode < 300 ? successResponseMaxBytes : ERROR_RESPONSE_MAX_BYTES;
	if (new TextEncoder().encode(text).byteLength > maxBytes) {
		throw new QueritResponseError(`Querit response exceeds the ${maxBytes}-byte limit.`, {
			statusCode,
		});
	}

	const rawSearchId = extractSearchId(text);
	let payload: unknown;
	let jsonInvalid = false;
	try {
		payload = JSON.parse(text);
	} catch {
		jsonInvalid = true;
	}
	if (jsonInvalid) {
		const excerpt = redactSecret(text.slice(0, 500), apiKey).replace(/\s+/gu, ' ').trim();
		const message =
			statusCode >= 200 && statusCode < 300
				? `Querit returned invalid JSON${excerpt ? `: ${excerpt}` : '.'}`
				: `Querit request returned HTTP ${statusCode}${excerpt ? `: ${excerpt}` : '.'}`;
		throw new QueritResponseError(message, { statusCode, searchId: rawSearchId });
	}

	if (!isRecord(payload)) {
		throw new QueritResponseError('Querit returned an invalid response object.', {
			statusCode,
			searchId: rawSearchId,
		});
	}

	const searchId = rawSearchId ?? normalizeSearchId(payload.search_id);
	const hasErrorCode = Object.prototype.hasOwnProperty.call(payload, 'error_code');
	const errorCode = optionalString(payload.error_code);
	const applicationSucceeded =
		errorCode !== undefined && Number.isFinite(Number(errorCode)) && Number(errorCode) === 200;
	const httpSucceeded = statusCode >= 200 && statusCode < 300;
	if (!httpSucceeded || (hasErrorCode && !applicationSucceeded)) {
		const fallback = httpSucceeded
			? `Querit returned application code ${errorCode ?? 'unknown'}.`
			: `Querit request returned HTTP ${statusCode}.`;
		const message = redactSecret(optionalString(payload.error_msg) ?? fallback, apiKey);
		throw new QueritResponseError(message, { statusCode, errorCode, searchId });
	}

	return {
		payload,
		...(searchId === undefined ? {} : { searchId }),
	};
}

function responseBodyToText(body: unknown): string {
	if (typeof body === 'string') return body;
	if (body instanceof Uint8Array) return new TextDecoder().decode(body);
	let encoded: string | undefined;
	let encodingFailed = false;
	try {
		encoded = JSON.stringify(body);
	} catch {
		encodingFailed = true;
	}
	if (encodingFailed) {
		throw new QueritResponseError('Querit returned a response body that could not be decoded.');
	}
	return encoded ?? '';
}

function extractSearchId(text: string): string | undefined {
	const match = /"search_id"\s*:\s*(?:"((?:\\.|[^"\\])*)"|(-?\d+))/u.exec(text);
	if (match === null) return undefined;
	if (match[2] !== undefined) return normalizeSearchId(match[2]);
	if (match[1] === undefined) return undefined;

	try {
		return normalizeSearchId(JSON.parse(`"${match[1]}"`));
	} catch {
		return undefined;
	}
}

function normalizeSearchId(value: unknown): string | undefined {
	const id = optionalString(value);
	if (id === undefined) return undefined;
	const normalized = sanitizeUntrustedText(id).replace(/\s+/gu, ' ').trim();
	return normalized ? normalized.slice(0, 128) : undefined;
}

function normalizeMetadata(value: unknown): QueritContentMetadata | undefined {
	if (!isRecord(value)) return undefined;
	const metadata: QueritContentMetadata = {};
	assignIfDefined(metadata, 'title', sanitizedString(value.title));
	assignIfDefined(metadata, 'url', normalizeHttpUrl(value.url));
	assignIfDefined(metadata, 'publishTime', sanitizedString(value.publishTime));
	assignIfDefined(metadata, 'siteName', sanitizedString(value.siteName));
	assignIfDefined(metadata, 'siteIcon', normalizeHttpUrl(value.siteIcon));
	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function normalizeHttpUrl(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.length > 4_096) return undefined;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
		if (url.username || url.password) return undefined;
		url.hash = '';
		return url.toString();
	} catch {
		return undefined;
	}
}

function normalizeDomains(value: unknown, fieldName: string): string[] {
	if (value === undefined || value === '') return [];
	const rawValues = Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: typeof value === 'string'
			? value.split(/[\s,;]+/u)
			: [];
	if (rawValues.length > 100) {
		throw new QueritInputError(`The '${fieldName}' option accepts at most 100 domains.`);
	}

	const domains = new Set<string>();
	for (const rawValue of rawValues) {
		const trimmed = rawValue.trim().toLowerCase();
		if (!trimmed) continue;
		const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
		let url: URL | undefined;
		try {
			url = new URL(candidate);
		} catch {
			url = undefined;
		}
		if (url === undefined) {
			throw new QueritInputError(`The '${fieldName}' option contains an invalid domain.`);
		}
		if (
			(url.protocol !== 'http:' && url.protocol !== 'https:') ||
			url.username ||
			url.password ||
			!url.hostname.includes('.') ||
			url.hostname.length > 253
		) {
			throw new QueritInputError(`The '${fieldName}' option contains an invalid domain.`);
		}
		domains.add(url.hostname.toLowerCase());
	}
	return [...domains];
}

function normalizeEnumValues(
	value: unknown,
	allowed: ReadonlySet<string>,
	fieldName: string,
): string[] {
	if (value === undefined || value === '') return [];
	const values = Array.isArray(value) ? value : [value];
	const normalized = new Set<string>();
	for (const entry of values) {
		if (typeof entry !== 'string' || !allowed.has(entry.trim().toLowerCase())) {
			throw new QueritInputError(`The '${fieldName}' option contains an unsupported value.`);
		}
		normalized.add(entry.trim().toLowerCase());
	}
	return [...normalized];
}

function normalizeTimeRange(value: unknown): string | undefined {
	if (value === undefined || value === '') return undefined;
	if (typeof value !== 'string') {
		throw new QueritInputError("The 'Time Range' option has an invalid value.");
	}
	const normalized = value.trim();
	if (!TIME_RANGE_PATTERN.test(normalized)) {
		throw new QueritInputError(
			"The 'Time Range' option must use d7, w2, m3, y1, or YYYY-MM-DDtoYYYY-MM-DD format.",
		);
	}
	if (normalized.includes('to')) {
		const [start, end] = normalized.split('to');
		if (
			start === undefined ||
			end === undefined ||
			!isIsoDate(start) ||
			!isIsoDate(end) ||
			start > end
		) {
			throw new QueritInputError(
				"The 'Time Range' option must contain a valid inclusive date range.",
			);
		}
	}
	return normalized;
}

function isIsoDate(value: string): boolean {
	const date = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requiredInteger(
	value: number,
	minimum: number,
	maximum: number,
	fieldName: string,
): number {
	if (!Number.isInteger(value) || value < minimum || value > maximum) {
		throw new QueritInputError(
			`The '${fieldName}' parameter must be an integer between ${minimum} and ${maximum}.`,
		);
	}
	return value;
}

function optionalInteger(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
	fieldName: string,
): number {
	if (value === undefined) return fallback;
	if (typeof value !== 'number') {
		throw new QueritInputError(`The '${fieldName}' option must be a number.`);
	}
	return requiredInteger(value, minimum, maximum, fieldName);
}

function optionalBoolean(value: unknown, fallback: boolean, fieldName: string): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== 'boolean') {
		throw new QueritInputError(`The '${fieldName}' parameter must be true or false.`);
	}
	return value;
}

function extractHttpStatus(error: unknown): number | undefined {
	if (!isRecord(error)) return undefined;
	for (const value of [error.httpCode, error.statusCode, error.status]) {
		const status = Number(value);
		if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
	}
	if (isRecord(error.response)) return extractHttpStatus(error.response);
	return undefined;
}

function assignIfDefined<T extends object, K extends keyof T>(
	target: T,
	key: K,
	value: T[K] | undefined,
): void {
	if (value !== undefined) target[key] = value;
}

function optionalString(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return undefined;
}

/** Remote text reaches workflow items and AI agents, so strip control sequences first. */
function sanitizedString(value: unknown): string | undefined {
	const text = optionalString(value);
	return text === undefined ? undefined : sanitizeUntrustedText(text);
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ESC = 0x1b;
const BEL = 0x07;
const DELETE = 0x7f;
const CSI = 0x9b;
const ST = 0x9c;
const OSC = 0x9d;
const CONTROL_STRING_STARTS = new Set([0x90, 0x98, 0x9e, 0x9f]);
const ESC_CONTROL_STRING_STARTS = new Set([0x50, 0x58, 0x5e, 0x5f]);
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

function sanitizeUntrustedText(value: string): string {
	let output = '';
	for (let index = 0; index < value.length; ) {
		const code = value.charCodeAt(index);
		if (code === ESC) {
			const next = value.charCodeAt(index + 1);
			if (next === 0x5b) index = skipCsi(value, index + 2);
			else if (next === 0x5d) index = skipOsc(value, index + 2);
			else if (ESC_CONTROL_STRING_STARTS.has(next)) index = skipControlString(value, index + 2);
			else index += Number.isNaN(next) ? 1 : 2;
			continue;
		}
		if (code === CSI) {
			index = skipCsi(value, index + 1);
			continue;
		}
		if (code === OSC) {
			index = skipOsc(value, index + 1);
			continue;
		}
		if (CONTROL_STRING_STARTS.has(code)) {
			index = skipControlString(value, index + 1);
			continue;
		}
		if (code === 0x0a || code === 0x09) {
			output += value[index];
			index += 1;
			continue;
		}
		if (code < 0x20 || (code >= 0x80 && code <= 0x9f) || code === DELETE) {
			index += 1;
			continue;
		}
		const codePoint = value.codePointAt(index);
		if (codePoint === undefined) break;
		output += String.fromCodePoint(codePoint);
		index += codePoint > 0xffff ? 2 : 1;
	}
	return output.replace(BIDI_CONTROLS, '');
}

function skipCsi(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		index += 1;
		if (code >= 0x40 && code <= 0x7e) return index;
	}
	return index;
}

function skipOsc(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === BEL || code === ST) return index + 1;
		if (code === ESC && value.charCodeAt(index + 1) === 0x5c) return index + 2;
		index += 1;
	}
	return index;
}

function skipControlString(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === ST) return index + 1;
		if (code === ESC && value.charCodeAt(index + 1) === 0x5c) return index + 2;
		index += 1;
	}
	return index;
}
