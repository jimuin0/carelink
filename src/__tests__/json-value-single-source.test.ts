/**
 * @jest-environment node
 *
 * jsonb 列へ渡す値の正規化（toJsonValue）が src/lib/json-value.ts の1本だけであることを強制する。
 *
 * 🔴 なぜ必要か: Supabase クライアントへ `<Database>` 型を配線した際、`Json` 型へ直接代入できない
 * 値（Stripe の Event・interface 由来の値・Record<string, unknown>）を扱う必要が6ファイルで同時に
 * 発生し、それぞれが【バイト単位で同一の toJsonValue を個別に実装】した（audit-logger /
 * webhook-queue / cron-logger / ab-test / stripe-webhook / gbp-place）。
 *
 * この形の重複は放置すると必ず壊れる。使われる先が監査ログ・webhook キュー・cron ログという
 * 「失敗しても画面に何も出ない」経路ばかりなので、どれか1つだけ挙動が変わっても誰も気づかず、
 * 記録内容が静かに欠ける。src/lib/err.ts の errorMessage と同じ理由で単一ソースにする。
 *
 * 検査は「関数を定義しているファイルが共有モジュールだけか」を見る。実装を各所へ書き戻した
 * 瞬間に赤くなる。
 */
import { execFileSync } from 'child_process';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../..');

/** src 配下で toJsonValue を「定義」しているファイルを列挙する（import しているだけの箇所は含めない）。 */
function filesDefiningToJsonValue(): string[] {
  let stdout = '';
  try {
    stdout = execFileSync(
      'grep',
      ['-rlE', '(function|const)\\s+toJsonValue', 'src', '--include=*.ts', '--include=*.tsx'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
  } catch (e) {
    // grep は一致0件で exit 1 を返す。定義が1つも無いのは「共有モジュールごと消えた」状態なので
    // 空配列として扱い、下の検査で落とす。
    const err = e as { status?: number; stdout?: string };
    if (err.status !== 1) throw e;
    stdout = err.stdout ?? '';
  }
  return stdout.split('\n').filter(Boolean).sort();
}

describe('toJsonValue の単一ソース', () => {
  it('定義しているのは src/lib/json-value.ts だけ', () => {
    expect(filesDefiningToJsonValue()).toEqual(['src/lib/json-value.ts']);
  });

  it('【空振り防止】利用側が実際に共有モジュールを import している', () => {
    // 上の検査は「定義が1つ」を見るだけなので、誰も使っていない状態でも通ってしまう。
    // 実利用が消えていないことまで確かめる。
    const stdout = execFileSync(
      'grep',
      ['-rl', "from '@/lib/json-value'", 'src', '--include=*.ts', '--include=*.tsx'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const importers = stdout.split('\n').filter(Boolean);
    expect(importers.length).toBeGreaterThanOrEqual(5);
  });
});
