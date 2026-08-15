/**
 * @jest-environment node
 *
 * eslint.config.mjs（flat config）が、.eslintrc.json 時代の設定を取りこぼしていないことを機械で検査する。
 *
 * 🔴 なぜ必要か: lint 設定の取りこぼしは【lint が緑のまま】起きる。ルールが1つ config から
 * 落ちても「違反が0件になった」だけに見えるので、CareLink 固有の安全規約
 * （carelink-safety の5ルール＝anon クライアントでの RLS 保護テーブル参照、Supabase の error
 * 握り潰し、投げっぱなし await 等を止める最終バリア）が無音で無効化される。
 * ESLint 8 → 9 の移行では config の書式・対象拡張子の既定・overrides の表現がすべて変わったため、
 * 移植漏れが起きても気づけない形になっていた。
 *
 * このテストは lint の実行結果（今何件出たか）ではなく【ファイルごとに解決された設定そのもの】を見る。
 * 違反がたまたま0件でも、ルールが外れれば落ちる。
 *
 * 🔴 設定の取得に eslint を実プロセスとして起動している理由:
 * (1) ESLint 9 は eslint.config.mjs を動的 import で読むため、jest の CJS ランタイムからは
 *     `A dynamic import callback was invoked without --experimental-vm-modules` で読めない。
 * (2) より本質的に、実際に `npm run lint` が使う経路そのものを検査できる。API から組み立てた
 *     設定が通っても、CLI が別の設定を読んでいたら意味がない。
 */
import { execFileSync } from 'child_process';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../..');

type ResolvedConfig = { rules?: Record<string, unknown> };

const cache = new Map<string, ResolvedConfig>();

function loadConfig(relPath: string): ResolvedConfig {
  const cached = cache.get(relPath);
  if (cached) return cached;
  const stdout = execFileSync('npx', ['eslint', '--print-config', relPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as ResolvedConfig;
  cache.set(relPath, parsed);
  return parsed;
}

function rulesOf(relPath: string): Record<string, unknown> {
  return loadConfig(relPath).rules ?? {};
}

/** ESLint の重大度表現（'error' / 2 / ['error', ...]）を数値に正規化する。 */
function severityOf(entry: unknown): number | undefined {
  const value = Array.isArray(entry) ? entry[0] : entry;
  if (value === 'error' || value === 2) return 2;
  if (value === 'warn' || value === 1) return 1;
  if (value === 'off' || value === 0 || value === undefined) return 0;
  return undefined;
}

const CARELINK_RULES = [
  'carelink-safety/no-await-fire-and-forget',
  'carelink-safety/no-bare-sentry-capture',
  'carelink-safety/no-discarded-supabase-error',
  'carelink-safety/no-anon-select-rls-protected-table',
  'carelink-safety/no-anon-write-rls-protected-table',
];

// overrides の対象外である通常の src ファイルの代表。
const NORMAL_FILE = 'src/lib/facilities.ts';
const TEST_FILE = 'src/lib/__tests__/facilities.test.ts';

// eslint の起動は1ファイルあたり数秒かかる。参照する設定を先に全部取り込んでおき、
// 個々の it が起動待ちでタイムアウトしないようにする（負荷が高いマシンでの偽の失敗を防ぐ）。
beforeAll(() => {
  [
    NORMAL_FILE,
    TEST_FILE,
    'src/lib/__tests__/rate-limit.test.ts',
    'src/lib/safe.ts',
    'src/app/admin/bookings/page.tsx',
    'src/app/admin/__tests__/placeholder.test.tsx',
    'src/app/page.tsx',
  ].forEach(loadConfig);
}, 300_000);

describe('eslint.config.mjs が .eslintrc.json の設定を保持している', () => {
  it('【空振り防止】設定が実際に解決でき、十分な数のルールを持つ', () => {
    // eslint-config-next（core-web-vitals + typescript）だけで100本前後のルールが入る。
    // ここが極端に少ない＝config の読み込みに失敗しており、以降の検査が
    // 「たまたま通る」状態になっていないことを保証する。
    expect(Object.keys(rulesOf(NORMAL_FILE)).length).toBeGreaterThan(50);
  });

  it('carelink-safety の5ルールが通常ファイルで error になっている', () => {
    const rules = rulesOf(NORMAL_FILE);
    for (const rule of CARELINK_RULES) {
      expect(severityOf(rules[rule])).toBe(2);
    }
  });

  it('TypeScript ファイルに typescript-eslint のルールが適用される（--ext 廃止後も対象拡張子が正しい）', () => {
    // flat config は既定で **/*.js しか対象にしない。files 宣言を落とすとここが undefined になる。
    expect(rulesOf(NORMAL_FILE)['@typescript-eslint/no-unused-vars']).toBeDefined();
  });

  it('alert / confirm と inMemoryRateLimit の禁止が生きている', () => {
    const rules = rulesOf(NORMAL_FILE);
    expect(severityOf(rules['no-restricted-globals'])).toBe(2);
    expect(severityOf(rules['no-restricted-properties'])).toBe(2);
    expect(severityOf(rules['no-restricted-imports'])).toBe(2);

    // メッセージ本文まで見る（ルール名だけ残して中身が空になる退行を捕まえる）。
    expect(JSON.stringify(rules['no-restricted-imports'])).toContain('inMemoryRateLimit');

    const restrictedGlobals = rules['no-restricted-globals'] as unknown[];
    const globalNames = restrictedGlobals
      .slice(1)
      .map((g) => (g as { name?: string }).name)
      .filter(Boolean);
    expect(globalNames).toEqual(expect.arrayContaining(['alert', 'confirm']));
  });
});

describe('overrides が flat config でも同じ範囲に効いている', () => {
  it('テストファイルでは4ルールが off（.eslintrc.json の1つ目の override）', () => {
    const rules = rulesOf(TEST_FILE);
    expect(severityOf(rules['@typescript-eslint/no-explicit-any'])).toBe(0);
    expect(severityOf(rules['@typescript-eslint/no-require-imports'])).toBe(0);
    expect(severityOf(rules['carelink-safety/no-bare-sentry-capture'])).toBe(0);
    expect(severityOf(rules['carelink-safety/no-await-fire-and-forget'])).toBe(0);
  });

  it('テストファイルでも「テスト用に緩めていないルール」は error のまま（負の対照）', () => {
    // override の files 指定が広すぎて無関係なルールまで巻き込んでいないことの確認。
    expect(severityOf(rulesOf(TEST_FILE)['carelink-safety/no-anon-select-rls-protected-table'])).toBe(2);
  });

  it('rate-limit.test.ts だけ no-restricted-imports が off', () => {
    expect(severityOf(rulesOf('src/lib/__tests__/rate-limit.test.ts')['no-restricted-imports'])).toBe(0);
    // 他のテストファイルでは効いたまま（files 指定が広がっていないことの負の対照）。
    expect(severityOf(rulesOf(TEST_FILE)['no-restricted-imports'])).toBe(2);
  });

  it('safe.ts だけ no-bare-sentry-capture が off', () => {
    expect(severityOf(rulesOf('src/lib/safe.ts')['carelink-safety/no-bare-sentry-capture'])).toBe(0);
    expect(severityOf(rulesOf(NORMAL_FILE)['carelink-safety/no-bare-sentry-capture'])).toBe(2);
  });

  it('管理画面の tsx では生の <table> が禁止される', () => {
    const rules = rulesOf('src/app/admin/bookings/page.tsx');
    expect(severityOf(rules['no-restricted-syntax'])).toBe(2);
    expect(JSON.stringify(rules['no-restricted-syntax'])).toContain('SbTable');
  });

  it('管理画面でもテスト配下は除外され、管理画面以外には効かない（excludedFiles → ignores の移植検査）', () => {
    // 現時点で src/app/admin 配下に .test.tsx は無いが、除外指定が効いていること自体は
    // パスに対する設定解決で検査できる（将来テストが追加された瞬間に守られる）。
    expect(severityOf(rulesOf('src/app/admin/__tests__/placeholder.test.tsx')['no-restricted-syntax'])).toBe(0);
    expect(severityOf(rulesOf('src/app/page.tsx')['no-restricted-syntax'])).toBe(0);
  });
});
