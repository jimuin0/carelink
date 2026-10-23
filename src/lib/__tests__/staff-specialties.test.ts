/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 得意分野は半角カンマでしか区切っておらず、「カット、カラー」が 1 件として保存されていた（2026年10月23日）。
 */
import { formatSpecialties, parseSpecialties } from '../staff-specialties';

test.each([
  ['カット、カラー、パーマ', ['カット', 'カラー', 'パーマ']],
  ['カット,カラー, パーマ', ['カット', 'カラー', 'パーマ']],
  ['鍼灸，整体', ['鍼灸', '整体']],
  ['鍼灸\n整体\r\n骨盤調整', ['鍼灸', '整体', '骨盤調整']],
  ['  ジェルネイル 、、 ,  ', ['ジェルネイル']],
  ['カット、カット,カット', ['カット']],
  ['', []],
  ['   ', []],
])('%p を分ける', (input, expected) => {
  expect(parseSpecialties(input)).toEqual(expected);
});

test('保存済みの配列を読点区切りで入力欄に戻し、そのまま保存し直しても変わらない', () => {
  const saved = ['ボディケア', 'アロマ'];
  expect(formatSpecialties(saved)).toBe('ボディケア、アロマ');
  expect(parseSpecialties(formatSpecialties(saved))).toEqual(saved);
});

test.each([null, undefined, []])('未設定 %p は空欄', (value) => {
  expect(formatSpecialties(value)).toBe('');
});
