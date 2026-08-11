/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * `scripts/gen-stub-schema.mjs` が【本番と同じ列型】を出すことを固定する（2026年8月11日 新設）。
 *
 * 🔴 【なぜ必要か＝実際に本番へ流出させた事故】
 * 調査用 SQL（`scripts/diagnose-*.sql`）を本番へ渡す前に、使い捨て Postgres で実行検証している。
 * このとき検証用スタブを【全列 text】で作っていたため、
 *
 *     ERROR: 42883 operator does not exist: text = uuid   (a.record_id = m.id)
 *
 * を検出できず、本番の SQL Editor で初めて落ちた。`audit_logs.record_id` は
 * どの表の id でも入る汎用列なので TEXT だが、各表の `id` は UUID。
 * `database.types.ts` はどちらも `string` として出すため、TypeScript でも区別できない。
 *
 * 型の正は `src/lib/schema-fingerprint.expected.json`（migration 群から機械生成）だけ。
 * スタブ生成がそこから正しく引けていることを、事故そのものの列ペアで固定する。
 */
import { execFileSync } from 'child_process';
import { join } from 'path';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts/gen-stub-schema.mjs');

function gen(tables: string[]): string {
  return execFileSync('node', [SCRIPT, ...tables], { encoding: 'utf8', cwd: ROOT });
}

describe('スタブ生成が本番の列型を再現する', () => {
  it('事故そのものの列ペアを正しい型で出す（record_id=text / id=uuid）', () => {
    const ddl = gen(['audit_logs', 'facility_menus']);
    expect(ddl).toMatch(/"record_id" text/);
    expect(ddl).toMatch(/"new_values" jsonb/);
    // 負の対照: 全列 text のスタブなら以下は uuid にならず、事故が再現しない
    expect(ddl).toMatch(/"id" uuid/);
    expect(ddl).not.toMatch(/"record_id" uuid/);
  });

  it('拡張型(postgis)は text へ落とし、落としたことを注記する', () => {
    const ddl = gen(['facility_profiles']);
    expect(ddl).toContain('拡張型のためスタブでは text に置換');
    // 注記コメント自体には元の型名が載るので、列定義の行だけを見る
    const definitions = ddl.split('\n').filter((l) => !l.trimStart().startsWith('--'));
    expect(definitions.join('\n')).not.toMatch(/public\.geography\(/);
    expect(definitions.some((l) => /"location" text/.test(l))).toBe(true);
  });

  it('注記が列定義の前行にあり、カンマを飲まない', () => {
    // 行末コメントにすると join(',\n') のカンマがコメントに入り、次の列定義が構文エラーになる。
    const ddl = gen(['facility_profiles']);
    for (const line of ddl.split('\n')) {
      if (line.includes('--')) expect(line.trimEnd().endsWith(',')).toBe(false);
    }
  });

  it('フィンガープリントに無いテーブルは失敗する（黙って空を返さない）', () => {
    expect(() => gen(['no_such_table_xyz'])).toThrow();
  });

  it('引数なしは使い方を出して失敗する', () => {
    expect(() => gen([])).toThrow();
  });
});
