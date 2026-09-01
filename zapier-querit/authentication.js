'use strict';

const { searchQuerit } = require('./lib/querit');

const AUTH_TEST_REQUEST = Object.freeze({
  query: 'Querit authentication test',
  count: 1,
});

const test = async (z, bundle) => {
  await searchQuerit(z, bundle, AUTH_TEST_REQUEST);
  return { authenticated: true };
};

module.exports = {
  type: 'custom',
  connectionLabel: 'Querit Account',
  fields: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText: 'Get your API key from your [Querit account](https://www.querit.ai).',
    },
  ],
  test,
};
