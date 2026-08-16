/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * React Compiler 負債ラチェットの純粋ロジックの単体テスト。
 *
 * eslint を実際に起動する層（scripts/check-react-compiler-debt.mjs）とは分けてある。
 * 判定そのものはここで決定的に検証し、スクリプト側は eslint の実行と受け渡しだけを担う。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  RATCHET_RULES,
  BASELINE,
  countDebt,
  checkDebt,
} from '@/lib/react-compiler-debt.mjs';

type EslintResult = { messages?: Array<{ ruleId?: string | null }> };

function resultsWith(ruleIds: Array<string | null>): EslintResult[] {
  return [{ messages: ruleIds.map((ruleId) => ({ ruleId })) }];
}

describe('RATCHET_RULES / BASELINE', () => {
  it('対象ルールが eslint.config.mjs で warn に落としているものと一致する', () => {
    // 設定側とここがずれると、警告に落としたのに数えていないルールが生まれ、
    // そのルールの違反だけ無制限に増やせるようになる。
    const config = readFileSync(join(__dirname, '../../../eslint.config.mjs'), 'utf8');
    const block = config.slice(config.indexOf("name: 'carelink/react-compiler-debt'"));
    for (const rule of RATCHET_RULES) {
      expect(block).toContain(`'${rule}': 'warn'`);
    }
    // 逆向き：設定側に warn があるのに RATCHET_RULES へ入れ忘れたものが無いこと。
    const warnedInConfig = [...block.matchAll(/'(react-hooks\/[a-z-]+)':\s*'warn'/g)].map((m) => m[1]);
    expect(warnedInConfig.sort()).toEqual([...RATCHET_RULES].sort());
  });

  it('BASELINE は非負の整数', () => {
    expect(Number.isInteger(BASELINE)).toBe(true);
    expect(BASELINE).toBeGreaterThanOrEqual(0);
  });
});

describe('countDebt', () => {
  it('対象ルールの指摘だけを数える', () => {
    const results = resultsWith([
      'react-hooks/set-state-in-effect',
      'react-hooks/purity',
      '@typescript-eslint/no-unused-vars',
      'react-hooks/exhaustive-deps',
    ]);
    expect(countDebt(results)).toBe(2);
  });

  it('複数ファイルにまたがって合算する', () => {
    const results = [
      ...resultsWith(['react-hooks/refs']),
      ...resultsWith(['react-hooks/immutability', 'react-hooks/immutability']),
    ];
    expect(countDebt(results)).toBe(3);
  });

  it('ruleId が null（パースエラー等）でも落ちない', () => {
    expect(countDebt(resultsWith([null]))).toBe(0);
  });

  it('messages を持たないファイル要素を無視する', () => {
    expect(countDebt([{}, { messages: undefined }])).toBe(0);
  });

  it('messages が配列でない場合を無視する', () => {
    expect(countDebt([{ messages: 'broken' } as unknown as EslintResult])).toBe(0);
  });

  it('message が null の要素を無視する', () => {
    expect(countDebt([{ messages: [null as unknown as { ruleId?: string }] }])).toBe(0);
  });

  it('配列でない入力には 0 を返す（eslint の出力が壊れたときに例外で止めない）', () => {
    expect(countDebt(null as unknown as EslintResult[])).toBe(0);
    expect(countDebt({} as unknown as EslintResult[])).toBe(0);
  });
});

describe('checkDebt', () => {
  it('ベースラインと一致すれば ok', () => {
    const verdict = checkDebt(10, 10);
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toContain('10');
  });

  it('増えたら ok=false（退行として止める）', () => {
    const verdict = checkDebt(12, 10);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('増えた');
    expect(verdict.message).toContain('+2');
  });

  it('減っても ok=false（ベースライン更新を要求する）', () => {
    // 「以下ならOK」にするとベースラインが実態より大きいまま残り、
    // その差分だけ増加を見逃す。ラチェットを緩めないための挙動。
    const verdict = checkDebt(7, 10);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('減った');
    expect(verdict.message).toContain('BASELINE');
  });

  it('baseline を省略すると BASELINE を使う', () => {
    expect(checkDebt(BASELINE).ok).toBe(true);
    expect(checkDebt(BASELINE + 1).ok).toBe(false);
  });
});
