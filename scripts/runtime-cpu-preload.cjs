'use strict';

const http = require('node:http');
const { attachCpuSampler } = require('./runtime-cpu-sampler.cjs');
const original = http.createServer;
http.createServer = function createServer(...args) {
  const server = Reflect.apply(original, this, args);
  attachCpuSampler(server);
  return server;
};
