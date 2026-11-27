'use strict';

const { messageOf } = require('../lib/sanitize');
const { searchQuerit } = require('../lib/querit');

const MAX_COUNT = 100;
const MAX_CHUNKS_PER_DOC = 3;
const CONTENT_MAX_CHARS_LIMIT = 1_000_000;
const HIGHLIGHTS_MIN_CHARACTERS = 100;
const HIGHLIGHTS_MAX_CHARACTERS = 8_000;
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
  'russian',
];

const TIME_RANGE_CHOICES = {
  d7: 'Past 7 days',
  w2: 'Past 2 weeks',
  m3: 'Past 3 months',
  y1: 'Past year',
};

// Querit's other time range forms: <unit letter><N> (days, weeks, months, years)
// and an inclusive date range.
const RELATIVE_TIME_RANGE = /^[dwmy][1-9]\d*$/u;
const ABSOLUTE_TIME_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/u;

const VERTICAL_CHOICES = {
  code: 'Code',
  finance: 'Finance',
};

const RESOURCE_TAG_CHOICES = {
  qa: 'Q&A pages',
  github: 'GitHub',
};
const RESOURCE_TAG_VALUES = Object.keys(RESOURCE_TAG_CHOICES);

const RANK_PREFERENCE_CHOICES = {
  relevance: 'Relevance',
  freshness: 'Freshness',
};

const toChoices = (values) => Object.fromEntries(
  values.map((value) => [value, value.replace(/\b\w/gu, (letter) => letter.toUpperCase())]),
);

const perform = async (z, bundle) => {
  let request;
  try {
    request = buildSearchRequest(bundle.inputData || {});
  } catch (error) {
    throw new z.errors.Error(messageOf(error), 'InvalidInputData', 400);
  }
  return searchQuerit(z, bundle, request);
};

const buildSearchRequest = (inputData) => {
  const query = typeof inputData.query === 'string' ? inputData.query.trim() : '';
  if (!query) throw new Error('Search Query is required.');
  if (query.length > 1000) throw new Error('Search Query must be 1,000 characters or fewer.');

  // Querit applies its own default count; only send one the user chose.
  const count = parseInteger(inputData.count, 1, MAX_COUNT, 'Result Count');
  const chunksPerDoc = parseInteger(inputData.chunks_per_doc, 1, MAX_CHUNKS_PER_DOC, 'Content Chunks per Result');
  const needContent = parseOptionalBoolean(inputData.include_content, 'Include Content');
  const contentMaxChars = parseInteger(
    inputData.content_max_chars,
    1,
    CONTENT_MAX_CHARS_LIMIT,
    'Content Max Characters',
  );
  if (contentMaxChars !== undefined && needContent !== true) {
    throw new Error('Content Max Characters requires Include Content to be on.');
  }

  const highlights = parseOptionalBoolean(inputData.highlights, 'Include Highlights');
  const highlightsMaxCharacters = parseInteger(
    inputData.highlights_max_characters,
    HIGHLIGHTS_MIN_CHARACTERS,
    HIGHLIGHTS_MAX_CHARACTERS,
    'Max Highlight Characters',
  );
  if (highlightsMaxCharacters !== undefined && highlights !== true) {
    throw new Error('Max Highlight Characters requires Include Highlights to be on.');
  }

  const includeDomains = parseDomains(inputData.include_domains, 'Include Domains');
  const excludeDomains = parseDomains(inputData.exclude_domains, 'Exclude Domains');
  const countries = parseAllowedList(inputData.countries, COUNTRY_VALUES, 'Countries');
  const languages = parseAllowedList(inputData.languages, LANGUAGE_VALUES, 'Languages');
  const timeRange = parseChoice(inputData.time_range, TIME_RANGE_CHOICES, 'Time Range');
  const customTimeRange = parseCustomTimeRange(inputData.time_range_custom);
  if (timeRange && customTimeRange) {
    throw new Error('Use either Time Range or Custom Time Range, not both.');
  }

  const vertical = parseChoice(inputData.vertical, VERTICAL_CHOICES, 'Vertical');
  const resourceTags = parseAllowedList(inputData.resource_tags, RESOURCE_TAG_VALUES, 'Resource Tags');
  if (resourceTags.length && vertical !== 'code') {
    throw new Error('Resource Tags require Vertical to be Code.');
  }

  // Querit rejects rank combined with the code vertical.
  const rankPreference = parseChoice(inputData.rank_preference, RANK_PREFERENCE_CHOICES, 'Rank Preference');
  if (rankPreference && vertical === 'code') {
    throw new Error('Rank Preference is not supported with the Code vertical.');
  }

  const filters = {};

  if (includeDomains.length || excludeDomains.length) {
    filters.sites = {
      ...(includeDomains.length ? { include: includeDomains } : {}),
      ...(excludeDomains.length ? { exclude: excludeDomains } : {}),
    };
  }
  if (timeRange || customTimeRange) filters.timeRange = { date: timeRange || customTimeRange };
  if (countries.length) filters.geo = { countries: { include: countries } };
  if (languages.length) filters.languages = { include: languages };
  if (vertical) filters.vertical = vertical;
  if (resourceTags.length) filters.resourceTags = { include: resourceTags };

  return {
    query,
    ...(count === undefined ? {} : { count }),
    ...(chunksPerDoc === undefined ? {} : { chunksPerDoc }),
    // Querit defaults both toggles to false, so an off toggle is simply not sent.
    ...(highlights
      ? { highlights: highlightsMaxCharacters === undefined ? true : { maxCharacters: highlightsMaxCharacters } }
      : {}),
    ...(needContent ? { needContent: true } : {}),
    ...(contentMaxChars === undefined ? {} : { contentMaxChars }),
    ...(rankPreference ? { rank: { preference: rankPreference } } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
  };
};

const parseInteger = (value, minimum, maximum, label) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
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

const parseChoice = (value, choices, label) => {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(choices, normalized)) {
    throw new Error(`${label} contains an unsupported value.`);
  }
  return normalized;
};

const parseCustomTimeRange = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (RELATIVE_TIME_RANGE.test(normalized)) return normalized;

  const range = ABSOLUTE_TIME_RANGE.exec(normalized);
  const from = range ? toEpochDay(range[1]) : undefined;
  const to = range ? toEpochDay(range[2]) : undefined;
  if (from === undefined || to === undefined || from > to) {
    throw new Error(
      'Custom Time Range must be a period such as d30, w6, m2, or y3, '
      + 'or a date range like 2026-01-01to2026-03-31 with the start date on or before the end date.',
    );
  }
  return normalized;
};

/** Days since the epoch for a real calendar date written as YYYY-MM-DD; any other input is invalid. */
const toEpochDay = (date) => {
  const epochMs = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(epochMs) && new Date(epochMs).toISOString().startsWith(date)
    ? epochMs / 86_400_000
    : undefined;
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
        helpText: 'Maximum number of results to return, from 1 to 100. Leave empty to use Querit\'s default count.',
      },
      {
        key: 'time_range',
        label: 'Time Range',
        type: 'string',
        required: false,
        choices: TIME_RANGE_CHOICES,
        helpText: 'Optionally limit results to a recent period. For any other period or exact dates, use Custom Time Range instead.',
      },
      {
        key: 'time_range_custom',
        label: 'Custom Time Range',
        type: 'string',
        required: false,
        placeholder: 'd30 or 2026-01-01to2026-03-31',
        helpText: 'A period such as `d30` (days), `w6` (weeks), `m2` (months), or `y3` (years), or a date range like `2026-01-01to2026-03-31`. Cannot be combined with Time Range.',
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
        key: 'vertical',
        label: 'Vertical',
        type: 'string',
        required: false,
        choices: VERTICAL_CHOICES,
        helpText: 'Search only this vertical. Leave empty for universal search; a vertical that does not match the query loses results.',
      },
      {
        key: 'resource_tags',
        label: 'Resource Tags',
        type: 'string',
        required: false,
        list: true,
        choices: RESOURCE_TAG_CHOICES,
        helpText: 'Limit code results to these source types. Requires Vertical to be Code.',
      },
      {
        key: 'rank_preference',
        label: 'Rank Preference',
        type: 'string',
        required: false,
        choices: RANK_PREFERENCE_CHOICES,
        helpText: 'Boost results that score best on this preference. Not supported with the Code vertical.',
      },
      {
        key: 'include_content',
        label: 'Include Content',
        type: 'boolean',
        required: false,
        helpText: 'Include sentence-level content excerpts with each result.',
      },
      {
        key: 'content_max_chars',
        label: 'Content Max Characters',
        type: 'integer',
        required: false,
        helpText: 'Maximum body characters per result, from 1 to 1,000,000. Requires Include Content; leave empty for the full body.',
      },
      {
        key: 'highlights',
        label: 'Include Highlights',
        type: 'boolean',
        required: false,
        helpText: 'Include query-focused fragments of the page body text with each result. Preferred over Content Chunks per Result.',
      },
      {
        key: 'highlights_max_characters',
        label: 'Max Highlight Characters',
        type: 'integer',
        required: false,
        helpText: 'Maximum highlight characters per result, from 100 to 8,000. Requires Include Highlights; leave empty to let Querit choose.',
      },
      {
        key: 'chunks_per_doc',
        label: 'Content Chunks per Result',
        type: 'integer',
        required: false,
        helpText: 'Deprecated by Querit; use Include Highlights instead. Number of content chunks to request per result, from 1 to 3. Sent only when set.',
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
      highlights: 'An example highlight fragment.',
      query: 'example query',
      search_id: '123456789',
      took: '0.42s',
      cost: 'USD 0.123456',
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
      { key: 'highlights', label: 'Highlights', type: 'string' },
      { key: 'query', label: 'Resolved Query', type: 'string' },
      { key: 'search_id', label: 'Search ID', type: 'string' },
      { key: 'took', label: 'Server Time', type: 'string' },
      { key: 'cost', label: 'Cost', type: 'string' },
    ],
  },
};
