/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * canonicalizeEmail — 同一人物突合用の正規化（Gmail 別名統合）の網羅テスト
 */
import { canonicalizeEmail } from '../email-canonical';

describe('canonicalizeEmail', () => {
  test('gmail: ローカル部のドットを除去', () => {
    expect(canonicalizeEmail('f.o.o@gmail.com')).toBe('foo@gmail.com');
  });

  test('gmail: "+tag" 以降を除去', () => {
    expect(canonicalizeEmail('foo+shopA@gmail.com')).toBe('foo@gmail.com');
  });

  test('gmail: ドット + tag の両方を除去', () => {
    expect(canonicalizeEmail('f.o.o+abc@gmail.com')).toBe('foo@gmail.com');
  });

  test('googlemail.com は gmail.com に統一', () => {
    expect(canonicalizeEmail('foo@googlemail.com')).toBe('foo@gmail.com');
    expect(canonicalizeEmail('f.o.o+x@googlemail.com')).toBe('foo@gmail.com');
  });

  test('大文字・前後空白は小文字化・trim される', () => {
    expect(canonicalizeEmail('  F.O.O+X@Gmail.COM  ')).toBe('foo@gmail.com');
  });

  test('非Gmail: ドット・"+tag" は保持（小文字化のみ）', () => {
    expect(canonicalizeEmail('a.b+c@example.com')).toBe('a.b+c@example.com');
    expect(canonicalizeEmail('A.B@Example.COM')).toBe('a.b@example.com');
  });

  test('@ を持たない値は小文字化のみ（正規化対象外）', () => {
    expect(canonicalizeEmail('NotAnEmail')).toBe('notanemail');
  });

  test('ローカル部が空（@始まり, at<=0）は小文字化のみ返す', () => {
    expect(canonicalizeEmail('@gmail.com')).toBe('@gmail.com');
  });

  test('gmail で除去後ローカル部が空になる不正値は元の小文字を返す', () => {
    // "+x@gmail.com": "+"以降除去でローカル空 → 元の小文字
    expect(canonicalizeEmail('+x@gmail.com')).toBe('+x@gmail.com');
    // "...@gmail.com": ドット除去でローカル空 → 元の小文字
    expect(canonicalizeEmail('...@gmail.com')).toBe('...@gmail.com');
  });

  test('gmail: 既に canonical な値は不変（冪等の一例）', () => {
    expect(canonicalizeEmail('foo@gmail.com')).toBe('foo@gmail.com');
  });

  test('複数 @ は最後の @ をドメイン境界に使う', () => {
    // 異常系だが lastIndexOf('@') を使う分岐の確認（非gmailドメインなので小文字化のみ）
    expect(canonicalizeEmail('a@b@example.com')).toBe('a@b@example.com');
  });
});
