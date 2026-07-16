/**
 * Tests for lib/feature-toggles.ts
 * SHOW_JOBS は「後日 true に戻すだけで復活させる」単一フラグ定数。
 * 2026年7月16日 神原さん判断で false 固定（求人の公開導線を一旦非表示）。
 */

import { SHOW_JOBS } from '../feature-toggles';

describe('SHOW_JOBS', () => {
  test('boolean 型である', () => {
    expect(typeof SHOW_JOBS).toBe('boolean');
  });

  test('現在は false（求人の公開導線を非表示にする神原さん判断・2026年7月16日）', () => {
    expect(SHOW_JOBS).toBe(false);
  });
});
