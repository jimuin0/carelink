/**
 * 過去に一度だけ適用した DDL の記録（docs/launch-audit-*-20260722.sql）を
 * 誤って再実行できないよう封印していることを固定する（2026年11月13日 点検 高-4）。
 *
 * 再実行すると後続 migration の是正（update_facility_rating の SECURITY DEFINER 化など）を
 * 古い定義へ巻き戻し、途中で止まって中途半端な状態を残す。本文全体をブロックコメントに入れ、
 * SQL Editor に貼っても 1 文も実行されない形にしてある。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SEALED = [
  'docs/launch-audit-ddl-20260722.sql',
  'docs/launch-audit-apply-20260722.sql',
];

/** 先頭の `--` 行と空行を除いた残りが、閉じ忘れも入れ子も無い 1 個のブロックコメントか。 */
function isFullySealed(sql: string): boolean {
  const rest = sql.split('\n');
  let i = 0;
  while (i < rest.length && /^\s*(--.*)?$/.test(rest[i])) i++;
  const tail = rest.slice(i).join('\n').trim();
  if (!tail.startsWith('/*') || !tail.endsWith('*/')) return false;
  const inner = tail.slice(2, -2);
  // PostgreSQL のブロックコメントは入れ子になる。内側に開始・終了があると封印が途中で切れ得る。
  return inner.trim().length > 0 && !inner.includes('/*') && !inner.includes('*/');
}

describe('実行禁止の DDL 記録は全文がコメントになっている', () => {
  it.each(SEALED)('%s', (rel) => {
    const sql = readFileSync(join(process.cwd(), rel), 'utf8');
    expect(sql).toContain('実行禁止');
    // 空振り防止：封印の中に当時の DDL 本文が残っている（＝検査対象を読めている）こと
    expect(sql).toMatch(/CREATE|ALTER|DELETE|DROP/);
    expect(isFullySealed(sql)).toBe(true);
  });

  it('負の対照：封印の外に文が 1 つでもあれば検出する', () => {
    expect(isFullySealed('-- x\n/*\nSELECT 1;\n*/\n')).toBe(true);
    expect(isFullySealed('-- x\nSELECT 1;\n')).toBe(false);
    expect(isFullySealed('-- x\n/*\nSELECT 1;\n*/\nDROP TABLE t;\n')).toBe(false);
    expect(isFullySealed('-- x\n/*\n/* nested */ SELECT 1;\n*/\n')).toBe(false);
    expect(isFullySealed('-- x\n/*\nSELECT 1;\n')).toBe(false);
  });
});
