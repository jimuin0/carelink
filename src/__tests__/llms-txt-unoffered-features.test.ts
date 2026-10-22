/**
 * AI 検索向けの案内（public/llms.txt）に、今は提供していない機能を載せない。
 *
 * 求人は「今はなし」（2026年10月23日 神原さん判断・src/lib/feature-toggles.ts の SHOW_JOBS）。
 * llms.txt は静的ファイルでコードから出し分けできないため、トグルと文面の対応をここで固定する
 * （SHOW_JOBS を true に戻したら、このテストが落ちて llms.txt の足し戻しを促す）。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SHOW_JOBS, SHOW_PACKAGES, SHOW_SUBSCRIPTIONS } from '@/lib/feature-toggles';

const llms = readFileSync(join(process.cwd(), 'public/llms.txt'), 'utf8');

test('llms.txt は空ではない（空振り防止）', () => {
  expect(llms).toContain('carelink-jp.com');
});

test('求人の扱いが SHOW_JOBS と一致する', () => {
  expect(/求人|採用/.test(llms)).toBe(SHOW_JOBS);
});

test('回数券・月額プランを提供していない間は案内しない', () => {
  expect(!SHOW_PACKAGES && llms.includes('回数券')).toBe(false);
  expect(!SHOW_SUBSCRIPTIONS && llms.includes('月額プラン')).toBe(false);
});
