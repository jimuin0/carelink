/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 応答後に走らせる Slack 通知が「投げっぱなし」になっていないことを固定する（2026年8月12日 新設）。
 *
 * 🔴 【なぜ必要か＝実際にあった状態】サーバーレスはレスポンスを返した時点でインスタンスを
 * 凍結・終了してよいため、`sendNotify(...)` を文の先頭で呼びっぱなしにすると完了が保証されない。
 * 該当していたのは【全部が問い合わせ・申し込みの受信通知】で、失われると気づく手段が無い:
 *   ・/api/contact  … 問い合わせフォームの受信通知
 *   ・旧 /api/salons … 現在は同一DBトランザクションの永続通知キューへ移行済み
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

/**
 * 【許可リスト方式】上の行頭検査は `void sendNotify(…)` や `const p = sendNotify(…)` を素通しする。
 * そこで、`sendNotify(` の呼び出しはすべて直前が `await ` か `runAfterResponse(() => ` であることを要求する
 * （それ以外の書き方は、待たれているかを機械的に保証できないので一律に落とす）。
 */
const SAFE_PREFIX_RE = /(?:\bawait[ \t]+|\brunAfterResponse\(\s*\(\s*\)\s*=>\s*)$/;
function unsafeNotifyCalls(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bsendNotify\s*\(/g)) {
    const before = src.slice(0, m.index);
    // 定義（export async function sendNotify(）は呼び出しではない
    if (/\bfunction[ \t]+$/.test(before)) continue;
    if (!SAFE_PREFIX_RE.test(before)) out.push(src.slice(Math.max(0, m.index - 40), m.index + 12).replace(/\s+/g, ' ').trim());
  }
  return out;
}

function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { if (entry !== '__tests__') out.push(...walkSources(full)); }
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

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
    expect(callers.map(f => relative(ROOT, f).split(sep).join('/')).sort()).toEqual([
      'src/app/api/admin/inquiries/[id]/reply/route.ts',
      'src/app/api/contact/route.ts', 'src/app/api/inquiry/route.ts',
    ]);
    // Registration must not add a second, direct notification path beside its durable outbox.
    expect(readFileSync(join(ROOT, 'src/app/api/salons/commit/route.ts'), 'utf8')).not.toContain('sendNotify(');
  });

  it('許可リスト検査は void・変数受け・then 連鎖の投げっぱなしも検出する（負の対照つき）', () => {
    expect(unsafeNotifyCalls('  void sendNotify({ type: "x" });')).toHaveLength(1);
    expect(unsafeNotifyCalls('  const p = sendNotify({ type: "x" });')).toHaveLength(1);
    expect(unsafeNotifyCalls('  if (ok) sendNotify({}).then(log);')).toHaveLength(1);
    expect(unsafeNotifyCalls('  runAfterResponse(() => sendNotify({\n  }));')).toEqual([]);
    expect(unsafeNotifyCalls('  const r = await sendNotify({});')).toEqual([]);
    expect(unsafeNotifyCalls('export async function sendNotify(payload) {}')).toEqual([]);
  });

  it('src/app と src/lib（lib のヘルパー経由を含む）の sendNotify 呼び出しは await か runAfterResponse 経由だけ', () => {
    const files = [...walkSources(join(ROOT, 'src/app')), ...walkSources(join(ROOT, 'src/lib'))];
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((f) =>
      unsafeNotifyCalls(readFileSync(f, 'utf8')).map((c) => `${relative(ROOT, f).split(sep).join('/')}: ${c}`));
    expect(offenders).toEqual([]);
  });

  it('投げっぱなしの sendNotify が残っていない', () => {
    const offenders = routes
      .filter((f) => FLOATING_NOTIFY_RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });
});
