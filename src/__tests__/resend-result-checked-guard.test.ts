/**
 * Resend の送信結果を捨てている呼び出しが 1 つも無いことを固定する（2026年8月14日 新設）。
 *
 * 🔴 【なぜ必要か＝実際にあった状態】Resend SDK は API エラーを **throw しない**
 * （`node_modules/resend/dist/index.mjs` の `fetchRequest` が `!response.ok` でも
 * ネットワーク断でも `{ data: null, error: … }` を resolve する）。そのため
 *
 *     try { await resend.emails.send(...); delivered = true } catch { … }
 *
 * と書くと catch には永遠に入らず、**1 通も送れていないのに配信済みとして記録される**。
 * この欠陥は 2026年7月8日に `src/lib/email.ts` の `safeSend` で一度根治されたが、
 * そこを通らない直接呼び出しがニュースレター手動配信と cron 5 本に残っていた
 * （＝「気づいた 1 箇所を直す」だけでは同じ class が別の場所で生き続けた）。
 *
 * 【検査の射程】「送信結果を **捨てている**」形だけを見る。値を受けて
 * `throwIfResendError` に渡すか、自前で `.error` を検査していれば通す。
 * 呼び出しごとの検査内容の正しさまでは静的には決められないので、そこは
 * `src/lib/__tests__/resend-result.test.ts` が検査関数側で固定する。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * 文の先頭に来る `await <何か>.emails.send(` / `.batch.send(` ＝ 戻り値を受け取っていない呼び出し。
 * 正しい形は `const r = await resend.emails.send(...)` ＋ `throwIfResendError(r, '…')`。
 */
const DISCARDED_SEND_RE = /^[ \t]*await\s+[\w.]+\.(?:emails|batch)\.send\(/m;

/** 送信呼び出しを含むか（走査が空振りしていないことの確認に使う）。 */
const ANY_SEND_RE = /\.(?:emails|batch)\.send\(/;

describe('Resend の送信結果を捨てている呼び出しが無い', () => {
  const files = walkTs(join(ROOT, 'src'));

  it('検出正規表現が機能する（負の対照つき）', () => {
    // 捨てている形＝違反
    expect(DISCARDED_SEND_RE.test('        await resend.emails.send({\n  from: x,\n});')).toBe(true);
    expect(DISCARDED_SEND_RE.test('  await resend.batch.send(messages);')).toBe(true);
    // 受けている形＝違反ではない
    expect(DISCARDED_SEND_RE.test('  const r = await resend.emails.send({ from: x });')).toBe(false);
    expect(DISCARDED_SEND_RE.test('  const r = await resend.batch.send(messages);')).toBe(false);
    // Promise.race に包む形（email.ts の safeSend）も違反ではない
    expect(DISCARDED_SEND_RE.test('    const result = await Promise.race([\n      resend.emails.send(params),\n    ]);')).toBe(false);
  });

  it('走査が空振りしていない（送信呼び出しを実際に見つけている）', () => {
    const withSend = files.filter((f) => ANY_SEND_RE.test(readFileSync(f, 'utf8')));
    // 実測 2026年8月14日: 7 ファイル（newsletter 手動配信・cron 5 本・lib/email.ts）。
    // 下限は実測の半分程度に置く（通常の増減で誤報させないため）。
    expect(withSend.length).toBeGreaterThanOrEqual(4);
  });

  it('送信結果を捨てている箇所が 1 つも無い', () => {
    const offenders = files
      .filter((f) => DISCARDED_SEND_RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });

  it('送信呼び出しを持つファイルは、結果を検査する手段を必ず持っている', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (!ANY_SEND_RE.test(src)) continue;
      // 共通の検査関数を通すか、自前で error を見ているか（email.ts の safeSend がこちら）。
      const checked = src.includes('throwIfResendError') || /\.error\b/.test(src);
      if (!checked) offenders.push(relative(ROOT, f).split(sep).join('/'));
    }
    expect(offenders).toEqual([]);
  });
});
