'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const merge = require('deepmerge');

test('Jest resolves the reviewed local security patch', () => {
  const fork = require('../tools/deepmerge/package.json');
  assert.equal(fork.name, '@carelink/deepmerge');
  assert.equal(fork.version, '4.3.2');
  const resolved = fs.realpathSync(require.resolve('deepmerge'));
  assert.equal(resolved, fs.realpathSync(path.join(__dirname, '../tools/deepmerge/index.cjs')));
  for (const parent of ['@jest/core/package.json', 'jest-cli/package.json']) {
    const parentDir = path.dirname(require.resolve(parent));
    const jestConfigDir = path.dirname(require.resolve('jest-config/package.json', { paths: [parentDir] }));
    assert.equal(fs.realpathSync(require.resolve('deepmerge', { paths: [jestConfigDir] })), resolved);
  }
});

test('rejects prototype poisoning in source and target, including nested placeholders', () => {
  const payload = JSON.parse('{"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}},"prototype":{"admin":true},"value":7}');
  for (const input of [merge(Object.create(null), payload), merge(payload, {}), merge({session: null}, {session: payload}).session, merge({}, {nested: [payload]}).nested[0]]) {
    assert.equal(Object.getPrototypeOf(input), Object.prototype);
    assert.equal(input.admin, undefined);
    assert.equal(input.value, 7);
    assert.equal(Object.hasOwn(input, '__proto__'), false);
    assert.equal(Object.hasOwn(input, 'constructor'), false);
    assert.equal(Object.hasOwn(input, 'prototype'), false);
  }
  assert.equal({}.admin, undefined);
});

test('retains ordinary merging, array, symbol, clone and custom merge behavior', () => {
  const sym = Symbol('example');
  const result = merge({a:{x:1}, list:[1], [sym]:'old'}, {a:{y:2}, list:[2], [sym]:'new'});
  assert.deepEqual(result.a, {x:1,y:2});
  assert.deepEqual(result.list, [1,2]);
  assert.equal(result[sym], 'new');
  assert.deepEqual(merge(null, {a:1}), {a:1});
  assert.deepEqual(merge(1, {a:1}), {a:1});
  assert.deepEqual(merge.all([{a:1}, {b:2}]), {a:1,b:2});
  assert.deepEqual(merge({a:[1]}, {a:[2]}, {arrayMerge: (_a, b) => b}), {a:[2]});
  assert.deepEqual(merge({a:{x:1}}, {a:{y:2}}, {customMerge: k => k === 'a' ? () => ({ok:true}) : undefined}), {a:{ok:true}});
});

test('does not accept a key when the target lookup throws', () => {
  const target = new Proxy({}, {has() { throw new Error('blocked'); }});
  assert.equal(Object.hasOwn(merge(target, {secret:'untrusted'}), 'secret'), false);
});
