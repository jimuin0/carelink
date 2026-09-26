/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const keys = ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY'];

function inspect(setup: string, configured: boolean) {
  // 出力は設定有無/一致結果だけ。資格情報の実値やconfig全文を表示しない。
  const child = spawnSync(process.execPath, ['-e', `
    const keys = ${JSON.stringify(keys)};
    const initial = keys.map(key => process.env[key]);
    require(${JSON.stringify(join(root, setup))});
    process.stdout.write(JSON.stringify({
      configured: keys.map(key => Boolean(process.env[key])),
      preserved: keys.every((key, i) => process.env[key] === initial[i]),
      sendKeysAbsent: ['RESEND_API_KEY','SLACK_BOT_TOKEN','UNKNOWN_PROVIDER_SECRET'].every(key => !process.env[key]),
      productionClientReplaced: process.env.SUPABASE_SERVICE_ROLE_KEY === 'test-service-role-key'
    }));
  `], {
    encoding: 'utf8',
    env: {
      ...(configured ? { STAGING_SUPABASE_URL: 'http://127.0.0.1:1', STAGING_SUPABASE_ANON_KEY: 'fixture-anon', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'fixture-service' } : {}),
      RESEND_API_KEY: 'fixture-send', SLACK_BOT_TOKEN: 'fixture-send', UNKNOWN_PROVIDER_SECRET: 'fixture-send',
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-must-be-replaced',
    },
  });
  expect(child.status).toBe(0);
  return JSON.parse(child.stdout);
}

test('Contractだけ明示注入Supabase envを保持し、その他のsecretは遮断する', () => {
  expect(inspect('jest.setup.contract.js', true)).toEqual({
    configured: [true, true, true], preserved: true, sendKeysAbsent: true, productionClientReplaced: true,
  });
});
test('未注入のContract接続情報を生成しない', () => {
  expect(inspect('jest.setup.contract.js', false)).toEqual({
    configured: [false, false, false], preserved: true, sendKeysAbsent: true, productionClientReplaced: true,
  });
});
test('unit setupはSTAGING鍵も従来通り削除する', () => {
  expect(inspect('jest.setup.js', true)).toEqual({
    configured: [true, false, false], preserved: false, sendKeysAbsent: true, productionClientReplaced: true,
  });
});
test('Contract configはNextの.env自動読込を無効にして専用setupを使う', async () => {
  const createConfig = jest.fn((config) => async () => config);
  const nextJest = jest.fn(() => createConfig);
  let loader: () => Promise<{ setupFiles: string[] }>;
  jest.isolateModules(() => {
    jest.doMock('next/jest', () => nextJest);
    loader = require('../../jest.config.contract.js');
  });
  expect(nextJest).toHaveBeenCalledWith();
  expect((await loader!()).setupFiles).toEqual(['<rootDir>/jest.setup.contract.js']);
});
