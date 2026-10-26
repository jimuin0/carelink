'use strict';

const http = require('node:http');
const { attachCpuSampler } = require('./runtime-cpu-sampler.cjs');
const { attachStaticAssetCdnCache } = require('./static-asset-cdn-cache.cjs');
const original = http.createServer;
http.createServer = function createServer(...args) {
  const server = Reflect.apply(original, this, args);
  attachCpuSampler(server);
  attachStaticAssetCdnCache(server);
  return server;
};
