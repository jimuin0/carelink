/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 応答後に走らせる Slack 通知が「投げっぱなし」になっていないことを固定する（2026年8月12日 新設）。
 *
 * 🔴 【なぜ必要か＝実際にあった状態】サーバーレスはレスポンスを返した時点でインスタンスを
 * 凍結・終了してよいため、`sendNotify(...)` を文の先頭で呼びっぱなしにすると完了が保証されない。
 * 該当していたのは【全部が問い合わせ・申し込みの受信通知】で、失われると気づく手段が無い:
 *   ・/api/contact  … 問い合わせフォームの受信通知
 *   ・/api/salons   … 施設掲載の新規登録／掲載申し込みの受信通知（2箇所）
 *   ・/api/inquiry  … 施設への問い合わせの受信通知
 *     （このファイルは await Promise.allSettled を持つが、sendNotify はその【後ろ】にあり
 *       待たれていなかった。「allSettled があるから安全」と読めてしまう紛らわしい形だった）
 *
 * 【検査の射程】`sendNotify` に限る。他の送信（メール／Push／LINE）は各ルートで
 * sideEffects 配列へ push して `await Promise.allSettled(...)` でまとめて待つ形になっており、
 * その形は行頭に関数呼び出しが来るため、同じ検査では誤検知になる。
 * 射程を広げるより、実害が出ていた形を確実に止めるほうを選ぶ。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();

function walkRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkRoutes(full));
    else if (full.endsWith(`${sep}route.ts`)) out.push(full);
  }
  return out;
}

/**
 * 文の先頭に来る `sendNotify(` ＝ await も runAfterResponse も付いていない投げっぱなし。
 * 正しい形は `runAfterResponse(() => sendNotify({` か `await sendNotify(`。
 */
const FLOATING_NOTIFY_RE = /^[ \t]*sendNotify\(/m;

describe('応答後の Slack 通知が投げっぱなしになっていない', () => {
  const routes = walkRoutes(join(ROOT, 'src/app/api'));

  it('検出正規表現が機能する（負の対照つき）', () => {
    expect(FLOATING_NOTIFY_RE.test('  sendNotify({\n    type: "contact",\n  });')).toBe(true);
    expect(FLOATING_NOTIFY_RE.test('  runAfterResponse(() => sendNotify({\n  }));')).toBe(false);
    expect(FLOATING_NOTIFY_RE.test('  await sendNotify({});')).toBe(false);
    expect(FLOATING_NOTIFY_RE.test('  const r = sendNotify({});')).toBe(false);
  });

  it('sendNotify を呼ぶルートが実在する（空振りを緑にしない）', () => {
    const callers = routes.filter((f) => readFileSync(f, 'utf8').includes('sendNotify('));
    expect(callers.length).toBeGreaterThanOrEqual(3);
  });

  it('投げっぱなしの sendNotify が残っていない', () => {
    const offenders = routes
      .filter((f) => FLOATING_NOTIFY_RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });
});
