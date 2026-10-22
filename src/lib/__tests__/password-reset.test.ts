import { AuthApiError, AuthSessionMissingError, AuthWeakPasswordError } from '@supabase/supabase-js';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_PWNED_MESSAGE,
  PASSWORD_SAME_MESSAGE,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_UPDATE_RETRY_MESSAGE,
  RECOVERY_LINK_EXPIRED_MESSAGE,
  describePasswordUpdateError,
  resetPasswordSchema,
  utf8ByteLength,
} from '../password-reset';

describe('utf8ByteLength', () => {
  test.each([
    ['', 0],
    ['abc', 3],
    ['é', 2],
    ['パス', 6],
    ['😀', 4],
    // 対になっていないサロゲートは TextEncoder と同じく U+FFFD（3 バイト）として数える
    ['\ud800', 3],
  ])('%j is %i bytes', (value, bytes) => {
    expect(utf8ByteLength(value)).toBe(bytes);
  });

  test('matches TextEncoder where it exists', () => {
    const { TextEncoder: NodeTextEncoder } = jest.requireActual<typeof import('util')>('util');
    for (const value of ['a1!', 'éß', 'あいう', '😀👍', 'mix あ😀é', '\udc00x']) {
      expect(utf8ByteLength(value)).toBe(new NodeTextEncoder().encode(value).length);
    }
  });
});

describe('resetPasswordSchema', () => {
  const parse = (password: string, confirm = password) =>
    resetPasswordSchema.safeParse({ password, password_confirm: confirm });
  const messages = (result: ReturnType<typeof parse>) =>
    result.success ? [] : result.error.issues.map(issue => issue.message);

  test('accepts exactly 72 bytes', () => {
    expect(PASSWORD_MAX_BYTES).toBe(72);
    expect(parse('a'.repeat(72)).success).toBe(true);
  });

  test('rejects 73 ASCII bytes before the request is sent', () => {
    expect(messages(parse('a'.repeat(73)))).toEqual([PASSWORD_TOO_LONG_MESSAGE]);
  });

  test('counts multi-byte characters as bytes, not characters', () => {
    // 25 文字だが 75 バイト。文字数で数えると通ってしまい、サーバーで拒否される
    expect(messages(parse('あ'.repeat(25)))).toEqual([PASSWORD_TOO_LONG_MESSAGE]);
    expect(parse('あ'.repeat(24)).success).toBe(true);
  });

  test('keeps the minimum length and confirmation rules', () => {
    expect(messages(parse('short'))).toEqual(['パスワードは8文字以上で入力してください']);
    const mismatch = parse('long-enough-1', 'long-enough-2');
    expect(mismatch.success).toBe(false);
    expect(mismatch.success ? null : mismatch.error.issues[0]).toMatchObject({
      message: 'パスワードが一致しません', path: ['password_confirm'],
    });
  });
});

describe('describePasswordUpdateError', () => {
  test('a leaked (pwned) password asks for a different password, not a new link', () => {
    const error = new AuthWeakPasswordError('Password is known to be weak', 422, ['pwned']);
    expect(describePasswordUpdateError(error)).toEqual({ message: PASSWORD_PWNED_MESSAGE, requestNewLink: false });
  });

  test('pwned wins even when other reasons are reported together', () => {
    const error = new AuthWeakPasswordError('weak', 422, ['length', 'pwned']);
    expect(describePasswordUpdateError(error).message).toBe(PASSWORD_PWNED_MESSAGE);
  });

  test('a too-short password explains the length rule', () => {
    const error = new AuthWeakPasswordError('weak', 422, ['length']);
    expect(describePasswordUpdateError(error)).toEqual({
      message: 'このパスワードは安全性の条件を満たしていません。より長いパスワードを入力してください。',
      requestNewLink: false,
    });
  });

  test('missing character classes explain the character rule', () => {
    const error = new AuthWeakPasswordError('weak', 422, ['characters']);
    expect(describePasswordUpdateError(error).message)
      .toBe('このパスワードは安全性の条件を満たしていません。英字の大文字・小文字・数字・記号を組み合わせてください。');
  });

  test('both length and characters are explained together', () => {
    const error = new AuthWeakPasswordError('weak', 422, ['length', 'characters']);
    expect(describePasswordUpdateError(error).message).toBe(
      'このパスワードは安全性の条件を満たしていません。より長いパスワードを入力してください。英字の大文字・小文字・数字・記号を組み合わせてください。',
    );
  });

  test('a weak_password without known reasons still explains the rules', () => {
    const error = new AuthApiError('weak', 422, 'weak_password');
    expect(describePasswordUpdateError(error)).toEqual({
      message: 'このパスワードは安全性の条件を満たしていません。8文字以上で、英字の大文字・小文字・数字・記号を組み合わせてください。',
      requestNewLink: false,
    });
  });

  test('the same password as before asks for a different one', () => {
    const error = new AuthApiError('New password should be different from the old password.', 422, 'same_password');
    expect(describePasswordUpdateError(error)).toEqual({ message: PASSWORD_SAME_MESSAGE, requestNewLink: false });
  });

  test('a missing session keeps the expired-link message and offers a new link', () => {
    expect(describePasswordUpdateError(new AuthSessionMissingError()))
      .toEqual({ message: RECOVERY_LINK_EXPIRED_MESSAGE, requestNewLink: true });
  });

  test.each(['bad_jwt', 'session_not_found', 'session_expired', 'refresh_token_not_found', 'refresh_token_already_used'])(
    'a server-side session loss (%s) offers a new link',
    code => {
      expect(describePasswordUpdateError(new AuthApiError('gone', 403, code)))
        .toEqual({ message: RECOVERY_LINK_EXPIRED_MESSAGE, requestNewLink: true });
    },
  );

  test.each([
    new AuthApiError('Password cannot be longer than 72 characters', 422, 'validation_failed'),
    new AuthApiError('Too many requests', 429, 'over_request_rate_limit'),
    { name: 'AuthRetryableFetchError' },
  ])('anything else shows a neutral retry message (no false "expired link")', error => {
    expect(describePasswordUpdateError(error)).toEqual({ message: PASSWORD_UPDATE_RETRY_MESSAGE, requestNewLink: false });
  });
});
