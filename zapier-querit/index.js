'use strict';

const zapier = require('zapier-platform-core');
const authentication = require('./authentication');
const { addBearerAuthorization } = require('./lib/querit');
const webSearch = require('./searches/web-search');

module.exports = {
  version: require('./package.json').version,
  platformVersion: zapier.version,
  authentication,
  beforeRequest: [addBearerAuthorization],
  afterResponse: [],
  triggers: {},
  searches: {
    [webSearch.key]: webSearch,
  },
  creates: {},
  resources: {},
};
