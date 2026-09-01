'use strict';

const { searchQuerit } = require('../lib/querit');

const DEFAULT_COUNT = 5;
const MAX_LIST_ITEMS = 20;

const COUNTRY_VALUES = [
  'argentina',
  'australia',
  'brazil',
  'canada',
  'colombia',
  'france',
  'germany',
  'india',
  'indonesia',
  'japan',
  'mexico',
  'nigeria',
  'philippines',
  'south korea',
  'spain',
  'united kingdom',
  'united states',
];

const LANGUAGE_VALUES = [
  'english',
  'japanese',
  'korean',
  'german',
  'french',
  'spanish',
  'portuguese',
];

const TIME_RANGE_CHOICES = {
  d7: 'Past 7 days',
  w2: 'Past 2 weeks',
  m3: 'Past 3 months',
  y1: 'Past year',
};

const toChoices = (values) => Object.fromEntries(
  values.map((value) => [value, value.replace(/\b\w/gu, (letter) => letter.toUpperCase())]),
);

const perform = async (z, bundle) => {
  let request;
  try {
    request = buildSearchRequest(bundle.inputData || {});
  } catch (error) {
    throw new z.errors.Error(
      error instanceof Error ? error.message : String(error),
      'InvalidInputData',
      400,
    );
  }
  return searchQuerit(z, bundle, request);
};

const buildSearchRequest = (inputData) => {
  const query = typeof inputData.query === 'string' ? inputData.query.trim() : '';
  if (!query) throw new Error('Search Query is required.');
  if (query.length > 1000) throw new Error('Search Query must be 1,000 characters or fewer.');

  const count = parseInteger(inputData.count, DEFAULT_COUNT, 1, 20, 'Result Count');
  const chunksPerDoc = parseOptionalInteger(inputData.chunks_per_doc, 1, 3, 'Content Chunks per Result');
  const needContent = parseOptionalBoolean(inputData.include_content, 'Include Content');
  const includeDomains = parseDomains(inputData.include_domains, 'Include Domains');
  const excludeDomains = parseDomains(inputData.exclude_domains, 'Exclude Domains');
  const countries = parseAllowedList(inputData.countries, COUNTRY_VALUES, 'Countries');
  const languages = parseAllowedList(inputData.languages, LANGUAGE_VALUES, 'Languages');
  const timeRange = parseTimeRange(inputData.time_range);
  const filters = {};

  if (includeDomains.length || excludeDomains.length) {
    filters.sites = {
      ...(includeDomains.length ? { include: includeDomains } : {}),
      ...(excludeDomains.length ? { exclude: excludeDomains } : {}),
    };
  }
  if (timeRange) filters.timeRange = { date: timeRange };
  if (countries.length) filters.geo = { countries: { include: countries } };
  if (languages.length) filters.languages = { include: languages };

  return {
    query,
    count,
    ...(chunksPerDoc === undefined ? {} : { chunksPerDoc }),
    ...(needContent === undefined ? {} : { needContent }),
    ...(Object.keys(filters).length ? { filters } : {}),
  };
};

const parseInteger = (value, defaultValue, minimum, maximum, label) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
};

const parseOptionalInteger = (value, minimum, maximum, label) => {
  if (value === undefined || value === null || value === '') return undefined;
  return parseInteger(value, minimum, minimum, maximum, label);
};

const parseOptionalBoolean = (value, label) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw new Error(`${label} must be true or false.`);
};

const parseDomains = (value, label) => {
  const domains = parseList(value);
  for (const domain of domains) {
    if (
      domain.length > 253
      || !domain.includes('.')
      || /\s/u.test(domain)
      || domain.includes('://')
      || /[/?#@]/u.test(domain)
    ) {
      throw new Error(`${label} must contain domain names only.`);
    }
  }
  return domains;
};

const parseAllowedList = (value, allowed, label) => {
  const entries = parseList(value);
  const allowedSet = new Set(allowed);
  if (entries.some((entry) => !allowedSet.has(entry))) {
    throw new Error(`${label} contains an unsupported value.`);
  }
  return entries;
};

const parseList = (value) => {
  if (value === undefined || value === null || value === '') return [];
  const rawValues = Array.isArray(value) ? value : [value];
  const normalized = new Set();

  for (const rawValue of rawValues) {
    if (typeof rawValue !== 'string') throw new Error('Filter values must be text.');
    for (const part of rawValue.split(/[,\n]/u)) {
      const entry = part.trim().toLowerCase();
      if (entry) normalized.add(entry);
    }
  }

  if (normalized.size > MAX_LIST_ITEMS) {
    throw new Error(`Each list filter accepts at most ${MAX_LIST_ITEMS} unique values.`);
  }
  return [...normalized];
};

const parseTimeRange = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(TIME_RANGE_CHOICES, normalized)) {
    throw new Error('Time Range contains an unsupported value.');
  }
  return normalized;
};

module.exports = {
  key: 'web_search',
  noun: 'Search Result',
  display: {
    label: 'Find Web Search Results',
    description: 'Finds live web search results.',
  },
  operation: {
    cleanInputData: false,
    inputFields: [
      {
        key: 'query',
        label: 'Search Query',
        type: 'string',
        required: true,
        helpText: 'The words or question to search for.',
      },
      {
        key: 'count',
        label: 'Result Count',
        type: 'integer',
        required: false,
        helpText: 'Number of results to return, from 1 to 20. Defaults to 5.',
      },
      {
        key: 'time_range',
        label: 'Time Range',
        type: 'string',
        required: false,
        choices: TIME_RANGE_CHOICES,
        helpText: 'Optionally limit results to a recent period.',
      },
      {
        key: 'countries',
        label: 'Countries',
        type: 'string',
        required: false,
        list: true,
        choices: toChoices(COUNTRY_VALUES),
        helpText: 'Optionally bias results toward up to 20 countries.',
      },
      {
        key: 'languages',
        label: 'Languages',
        type: 'string',
        required: false,
        list: true,
        choices: toChoices(LANGUAGE_VALUES),
        helpText: 'Optionally limit results to up to 20 languages.',
      },
      {
        key: 'include_domains',
        label: 'Include Domains',
        type: 'string',
        required: false,
        list: true,
        helpText: 'Only return results from these domains. Enter domain names without a URL scheme.',
      },
      {
        key: 'exclude_domains',
        label: 'Exclude Domains',
        type: 'string',
        required: false,
        list: true,
        helpText: 'Do not return results from these domains. Enter domain names without a URL scheme.',
      },
      {
        key: 'include_content',
        label: 'Include Content',
        type: 'boolean',
        required: false,
        helpText: 'Include sentence-level content excerpts with each result.',
      },
      {
        key: 'chunks_per_doc',
        label: 'Content Chunks per Result',
        type: 'integer',
        required: false,
        helpText: 'Number of content chunks to request per result, from 1 to 3.',
      },
    ],
    perform,
    sample: {
      id: '33669f5903a34ae12459c71239b4dc0a4d70d4f737f2dbc9899476d42928c12f',
      rank: 1,
      title: 'Example Search Result',
      url: 'https://example.com/querit-result',
      snippet: 'An example snippet returned by Querit.',
      page_age: '2026-01-01',
      site_name: 'Example',
      site_icon: 'https://example.com/favicon.ico',
      content: 'An example content excerpt.',
      query: 'example query',
      search_id: '123456789',
      took: '0.42s',
    },
    outputFields: [
      { key: 'id', label: 'ID', type: 'string' },
      { key: 'rank', label: 'Rank', type: 'integer' },
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'url', label: 'URL', type: 'string' },
      { key: 'snippet', label: 'Snippet', type: 'string' },
      { key: 'page_age', label: 'Page Age', type: 'string' },
      { key: 'site_name', label: 'Site Name', type: 'string' },
      { key: 'site_icon', label: 'Site Icon URL', type: 'string' },
      { key: 'content', label: 'Content Excerpts', type: 'string' },
      { key: 'query', label: 'Resolved Query', type: 'string' },
      { key: 'search_id', label: 'Search ID', type: 'string' },
      { key: 'took', label: 'Server Time', type: 'string' },
    ],
  },
};
