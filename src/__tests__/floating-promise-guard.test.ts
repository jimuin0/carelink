/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 応答後に走らせたい非同期処理を `void doSomething()` で投げっぱなしにしないことを固定する
 * （2026年8月12日 新設）。
 *
 * 🔴 【なぜ必要か】サーバーレスはレスポンスを返した時点でインスタンスを凍結・終了してよいため、
 * 浮いた Promise は完了が保証されない。本番の audit_logs が全期間 5 行しか無く、うち 4 行が
 * DB トリガ由来だった（PR#587）のが実測。同じ形が他にも残っていた:
 *
 *   ・review/route.ts       … 医療広告ガイドライン違反の口コミを審査キューへ登録する RPC。
 *                             失われると違反レビューが誰にも気づかれず公開され続ける
 *   ・line.ts / email.ts    … 送信失敗時の【再送キュー登録】。失われると失敗した通知が
 *                             二度と再送されない（失敗そのものが無かったことになる）
 *   ・cron-logger.ts        … 管理画面ハートビート
 *   ・slack/interactions    … Slack の 3 秒 ack 制約のため意図的に非同期化していた処理
 *
 * 【判定の要点】`void x;`（TypeScript の未使用変数抑制）と `void x();`（浮いた Promise）を
 * 区別する。前者は括弧を伴わないので、括弧の有無で機械的に切り分けられる。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();

function walk(dir: string, accept: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, accept));
    else if (accept(full)) out.push(full);
  }
  return out;
}

const isTest = (p: string) => p.includes(`${sep}__tests__${sep}`) || p.endsWith('.test.ts');

/** 文の先頭の `void <なにか>(` ＝ 呼び出しを投げっぱなしにしている形。 */
const FLOATING_RE = /^[ \t]*void\s+[^;\n]*\(/m;

/**
 * `void writeAuditLog(...)` は 83 箇所あるが、writeAuditLog 自身が内部で
 * runAfterResponse に載せている（PR#587）ため、この `void` は
 * 「解決済み Promise を捨てている」だけで実害が無い。呼び出し側 83 箇所を書き換える
 * 変更のほうがリスクが高いので、ここで明示的に許す。
 */
const ALLOWED = /^[ \t]*void\s+writeAuditLog\(/;

function floatingLines(src: string): string[] {
  return src
    .split('\n')
    .filter((l) => /^[ \t]*void\s+[^;\n]*\(/.test(l))
    .filter((l) => !ALLOWED.test(l));
}

describe('浮いた Promise を残さない', () => {
  const files = [
    ...walk(join(ROOT, 'src/app/api'), (p) => p.endsWith('.ts') && !isTest(p)),
    ...walk(join(ROOT, 'src/lib'), (p) => p.endsWith('.ts') && !isTest(p)),
  ];

  it('走査対象が存在する（空振りを緑にしない）', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('検出が「未使用変数抑制」と「投げっぱなし」を区別する（負の対照つき）', () => {
    // 投げっぱなし＝括弧あり
    expect(FLOATING_RE.test('    void enqueueWebhook({')).toBe(true);
    expect(FLOATING_RE.test("    void supabase.rpc('x', {")).toBe(true);
    expect(FLOATING_RE.test('        void (async () => {')).toBe(true);
    // 未使用変数抑制＝括弧なし。これは TypeScript の常套手段なので誤検知してはいけない
    expect(FLOATING_RE.test('    void menu; void staff;')).toBe(false);
    expect(FLOATING_RE.test('  void bookingData;')).toBe(false);
    // 正しい形は検出しない
    expect(FLOATING_RE.test('    runAfterResponse(() => enqueueWebhook({')).toBe(false);
    expect(FLOATING_RE.test('    await enqueueWebhook({')).toBe(false);
  });

  it('src/app/api と src/lib に投げっぱなしが残っていない', () => {
    const offenders = files.flatMap((f) => {
      const lines = floatingLines(readFileSync(f, 'utf8'));
      return lines.map((l) => `${relative(ROOT, f).split(sep).join('/')}: ${l.trim()}`);
    });
    expect(offenders).toEqual([]);
  });

  it('許可している writeAuditLog は実際に runAfterResponse 経由である', () => {
    // 許可の前提が崩れたら（writeAuditLog が直接 insert に戻ったら）許可も無効になる。
    const src = readFileSync(join(ROOT, 'src/lib/audit-logger.ts'), 'utf8');
    expect(src).toContain('runAfterResponse');
  });
});
