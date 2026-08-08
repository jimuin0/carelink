/**
 * E2E の「待ち予算」が、そのテストの制限時間を超えていないことを機械で強制する。
 *
 * 🔴 why(2026年8月8日 CI 実測): `e2e/admin-jobs.spec.ts` は
 *   `toPass({ timeout: 45000, intervals: [500, 1000, 2000] })` で再試行を設計していたが、
 *   Playwright の既定テスト timeout は **30000ms**（`playwright.config.ts` は `timeout` を
 *   設定していない）。**予算 45s > 制限 30s** なので、設計した再試行は最後まで一度も実行されない。
 *
 *   実測（run 31186576371 / job 92892863372）: Playwright の 3 回のリトライがすべて
 *   `Test timeout of 30000ms exceeded` で死んだ。内側の `waitForURL` が 15000ms のため、
 *   1 回目が外れると 2 回目の待ちは 15.5s→30.5s となり必ず 30s の壁で打ち切られる。
 *   intervals は名目上 3 回以上の再試行を意味するのに、実際に取れるのは
 *   「1 回 ＋ 途中で切られる 1 回」だけだった。
 *
 * 🔴 なぜ「その 1 箇所を直す」で終わらせないか:
 *   これは **発火源の列挙** になる。次に誰かが長い待ちを書いたとき、また同じ形で
 *   「retry しているつもりで retry できていない」テストが生まれる。しかもその失敗は
 *   flaky に見えるので、**再実行で緑にして通してしまう**（＝欠陥が観測されないまま残る）。
 *   予算と制限時間の大小は静的に判定できるので、性質として固定する。
 *
 * ⚠️ 対処として `playwright.config.ts` の既定 timeout を全体で伸ばさないこと。
 *   他の spec の「速く落ちる」性質まで鈍らせ、本物の停止を検知するまでの時間が延びる。
 *   長い予算を要求している当のテストに `test.setTimeout(N)` を置くのが正しい。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const E2E_DIR = join(REPO_ROOT, 'e2e');

/** Playwright の既定テスト timeout（config が `timeout` を持たないときの値）。 */
const PLAYWRIGHT_DEFAULT_TEST_TIMEOUT_MS = 30_000;

/** `90_000` / `90000` のどちらの表記でも数値にする。 */
function toMs(literal: string): number {
  return Number(literal.replace(/_/g, ''));
}

/**
 * `defineConfig({...})` の **最上位** にある `timeout:` を返す。無ければ null。
 *
 * 🔴 why: 単純な `/timeout:\s*(\d+)/` だと `expect: { timeout: 10000 }` の値を拾い、
 *   **実際(30000)より短い 10000 を制限時間だと信じてしまう**。そうなると全 spec の
 *   15000ms の待ちが一斉に「違反」になる＝誤報の洪水で、検知は死ぬ。
 *   ⚠️ 実際にこの欠陥を最初の実装で作り込み、下の負の対照が捕まえた。
 *
 * 実装: 波括弧・角括弧・丸括弧の深さを数え、**深さ 1 の文字だけ**を連結してから照合する。
 *   こうすると `expect: { timeout: 10000 },` は `expect: ,` に潰れ、内側は原理的に見えない
 *   （「行単位で見て深さを確認する」方式だと、開いて閉じるのが同一行だと素通りする）。
 */
export function topLevelTimeoutMs(src: string): number | null {
  const start = src.indexOf('defineConfig({');
  if (start < 0) throw new Error('defineConfig({ が無い');

  let depth = 0;
  let topLevel = '';
  for (let i = start + 'defineConfig('.length; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth === 1) topLevel += ch;
  }
  const m = topLevel.match(/(?:^|[,\n])\s*timeout:\s*([\d_]+)/);
  return m ? toMs(m[1]) : null;
}

/** config に最上位 timeout が無ければ Playwright の既定値。 */
function configTestTimeoutMs(): number {
  const src = readFileSync(join(REPO_ROOT, 'playwright.config.ts'), 'utf8');
  return topLevelTimeoutMs(src) ?? PLAYWRIGHT_DEFAULT_TEST_TIMEOUT_MS;
}

/** そのファイルに効くテスト制限時間。`test.setTimeout(N)` があればそれが勝つ。 */
export function effectiveTestTimeoutMs(src: string, configMs: number): number {
  const m = src.match(/test\.setTimeout\(\s*([\d_]+)\s*\)/);
  return m ? toMs(m[1]) : configMs;
}

/** ファイル中の明示 timeout をすべて拾う（`toPass` の予算と、単発の `{ timeout: N }`）。 */
export function explicitWaitsMs(src: string): { kind: string; ms: number }[] {
  const out: { kind: string; ms: number }[] = [];
  for (const m of src.matchAll(/\.toPass\(\s*\{[^}]*?timeout:\s*([\d_]+)/g)) {
    out.push({ kind: 'toPass', ms: toMs(m[1]) });
  }
  // `test.setTimeout(...)` 自身は待ちではないので除く。
  for (const m of src.matchAll(/\{\s*timeout:\s*([\d_]+)\s*\}/g)) {
    out.push({ kind: 'wait', ms: toMs(m[1]) });
  }
  return out;
}

function specFiles(): string[] {
  return readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts') || f.endsWith('.setup.ts'))
    .sort();
}

describe('E2E の待ち予算がテストの制限時間を超えていないこと', () => {
  const configMs = configTestTimeoutMs();

  it('走査が空振りしていない（spec が十分な数ある）', () => {
    // サイレント・ゼロ対策。0 件でも `offenders === []` は緑になってしまう。
    // 実測 2026年8月8日: 45 本。下限は 20（通常の増減で誤報しない位置＝実測の半分弱）。
    expect(specFiles().length).toBeGreaterThanOrEqual(20);
  });

  it('config の最上位 timeout を正しく読めている（ネストの値を拾っていない）', () => {
    // 正の対照: 現状 config は最上位 timeout を持たないので既定 30000 になるはず。
    // `expect: { timeout: 10000 }` を拾っていたら 10000 になり、ここで落ちる。
    expect(configMs).toBe(PLAYWRIGHT_DEFAULT_TEST_TIMEOUT_MS);
  });

  it('🔴 どの待ちも、そのテストの制限時間より短いこと', () => {
    const offenders: string[] = [];
    for (const f of specFiles()) {
      const src = readFileSync(join(E2E_DIR, f), 'utf8');
      const limit = effectiveTestTimeoutMs(src, configMs);
      for (const w of explicitWaitsMs(src)) {
        if (w.ms >= limit) {
          offenders.push(`${f}: ${w.kind} ${w.ms}ms >= テスト制限 ${limit}ms`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('🔴 admin-jobs は toPass の予算を満たせる制限時間を持つこと（回帰固定）', () => {
    const src = readFileSync(join(E2E_DIR, 'admin-jobs.spec.ts'), 'utf8');
    const limit = effectiveTestTimeoutMs(src, configMs);
    const toPass = explicitWaitsMs(src).filter((w) => w.kind === 'toPass');
    expect(toPass.length).toBeGreaterThanOrEqual(1);
    // 予算そのものではなく「予算 + 前後の待ち」が入る余地まで見る。
    const total = explicitWaitsMs(src).reduce((a, w) => a + w.ms, 0);
    expect(limit).toBeGreaterThanOrEqual(total);
  });
});

describe('負の対照: 検出ロジックが本当に違反を捕まえること', () => {
  // 走査が動いていても、正規表現が壊れていれば同じく永久に緑になる。
  // 「常に緑」でも「常に赤」でもないことを両方向で固定する。
  it('制限時間より長い toPass を違反として検出する', () => {
    const bad = `test('x', async () => { await expect(async () => {}).toPass({ timeout: 45000 }); });`;
    const limit = effectiveTestTimeoutMs(bad, 30_000);
    expect(limit).toBe(30_000);
    expect(explicitWaitsMs(bad).some((w) => w.kind === 'toPass' && w.ms >= limit)).toBe(true);
  });

  it('test.setTimeout があればそちらを制限時間として採用する', () => {
    const good = `test.setTimeout(90_000);\ntest('x', async () => { await expect(async () => {}).toPass({ timeout: 45000 }); });`;
    const limit = effectiveTestTimeoutMs(good, 30_000);
    expect(limit).toBe(90_000);
    expect(explicitWaitsMs(good).every((w) => w.ms < limit)).toBe(true);
  });

  it('制限時間より長い単発の待ちも検出する', () => {
    const bad = `await expect(x).toBeVisible({ timeout: 60000 });`;
    expect(explicitWaitsMs(bad).some((w) => w.kind === 'wait' && w.ms >= 30_000)).toBe(true);
  });

  it('制限時間より短い待ちは違反にしない（誤報しない）', () => {
    const ok = `await page.waitForURL('**/x', { timeout: 15000 });`;
    expect(explicitWaitsMs(ok).every((w) => w.ms < 30_000)).toBe(true);
  });

  // ⚠️ 以下は **本物の関数** を呼ぶこと。同じ正規表現を負の対照側に書き写すと、
  //   本体を壊しても対照が一緒に壊れないため「常に緑」になる（対照が対照になっていない）。
  it('config パーサはネストした timeout を最上位と誤認しない', () => {
    // 🔴 最初の実装はここで落ちた（`expect: { timeout: 10000 }` を最上位と誤認していた）。
    const nested = `export default defineConfig({\n  testDir: './e2e',\n  expect: { timeout: 10000 },\n});`;
    expect(topLevelTimeoutMs(nested)).toBeNull();
  });

  it('config パーサは最上位の timeout を読む', () => {
    const top = `export default defineConfig({\n  timeout: 60000,\n  expect: { timeout: 10000 },\n});`;
    expect(topLevelTimeoutMs(top)).toBe(60_000);
  });

  it('config パーサは projects 配列の入れ子に潜る timeout も拾わない', () => {
    const deep = `export default defineConfig({\n  projects: [{ name: 'a', use: { timeout: 5000 } }],\n});`;
    expect(topLevelTimeoutMs(deep)).toBeNull();
  });
});
