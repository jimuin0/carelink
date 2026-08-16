#!/usr/bin/env node
/**
 * React Compiler 系 react-hooks ルールの負債件数がベースラインと一致するかを検査する。
 *
 * 使い方: node scripts/check-react-compiler-debt.mjs
 * 判定ロジックは src/lib/react-compiler-debt.mjs（純粋関数・単体テスト済み）に置いてある。
 * このスクリプトは eslint を実行して JSON を渡すだけの薄い層。
 *
 * 🔴 exit code をそのまま CI のゲートに使う。eslint 自体は警告のみなら 0 を返すので、
 * この検査が無いと負債の増加は誰にも気づかれない。
 */
import { execFileSync } from 'child_process';
import { countDebt, checkDebt, BASELINE } from '../src/lib/react-compiler-debt.mjs';

function main() {
  let stdout;
  try {
    // eslint は警告のみなら exit 0、エラーがあれば exit 1 を返すが、どちらでも
    // JSON は stdout に出る。エラーの有無は `npm run lint` 側が別途ゲートするので、
    // ここでは exit code を理由に中断しない。
    stdout = execFileSync('npx', ['eslint', 'src', '--format', 'json'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    stdout = err && typeof err.stdout === 'string' ? err.stdout : '';
    if (!stdout) {
      console.error('eslint の実行に失敗し、JSON を取得できなかった。');
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    }
  }

  let results;
  try {
    results = JSON.parse(stdout);
  } catch {
    console.error('eslint の出力を JSON として解釈できなかった。');
    process.exit(1);
  }

  // 空振り防止: src を検査していれば必ず多数のファイルが結果に含まれる。
  // 0 件なら「負債も 0」ではなく「そもそも検査できていない」。
  if (!Array.isArray(results) || results.length < 100) {
    console.error(
      `eslint の検査対象が ${Array.isArray(results) ? results.length : 0} ファイルしかない。` +
        'src 全体を検査できていない可能性が高いので、負債 0 とは判定しない。',
    );
    process.exit(1);
  }

  const count = countDebt(results);
  const verdict = checkDebt(count, BASELINE);
  console.log(verdict.message);
  process.exit(verdict.ok ? 0 : 1);
}

main();
