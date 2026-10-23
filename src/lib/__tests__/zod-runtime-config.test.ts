/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * zod v4 はスキーマ作成時に `new Function('')` で eval の可否を探る。CSP が 'unsafe-eval' を
 * 許さないため、ブラウザは全ページでこの探査を CSP 違反として報告していた。
 * jitless を、どのスキーマよりも先に（クライアント・サーバーの instrumentation から）設定する。
 */
// zod の設定は globalThis.__zod_globalConfig に置かれ、モジュールを読み直しても残る。
// テストの順番に依存しないよう、毎回未設定に戻してから測る。
beforeEach(() => {
  delete (globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig?.jitless;
});

function countEvalProbes(configure: boolean): number {
  let probes = 0;
  const original = globalThis.Function;
  globalThis.Function = new Proxy(original, {
    // zod の探査は new Function('')。カバレッジ計測（istanbul）の new Function('return this') は数えない。
    construct(target, args) { if (args.length === 1 && args[0] === '') probes += 1; return Reflect.construct(target, args); },
  });
  try {
    jest.isolateModules(() => {
      if (configure) require('../zod-runtime-config');
      const { z } = require('zod');
      expect(z.object({ name: z.string() }).parse({ name: 'synthetic' })).toEqual({ name: 'synthetic' });
    });
  } finally {
    globalThis.Function = original;
  }
  return probes;
}

test('without the config zod probes eval when a schema is built (negative control)', () => {
  expect(countEvalProbes(false)).toBeGreaterThan(0);
});

test('with the config no schema probes eval, and parsing still works', () => {
  expect(countEvalProbes(true)).toBe(0);
});

test('the config sets jitless on the shared zod instance', () => {
  jest.isolateModules(() => {
    require('../zod-runtime-config');
    expect(require('zod').z.config().jitless).toBe(true);
  });
});

test.each(['src/instrumentation-client.ts', 'src/instrumentation.ts'])('%s loads the config before any other import', file => {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  const imports = source.split('\n').filter(line => /^import /.test(line));
  expect(imports[0]).toBe("import './lib/zod-runtime-config';");
});
