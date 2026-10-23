/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { newPasswordField, PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, PASSWORD_RULES_HINT } from '../password-policy';
import { resetPasswordSchema } from '../password-reset';
import { signupSchema } from '../validations-auth';

/**
 * 新規登録と再設定でパスワードの条件が食い違っていた（登録＝8〜128文字、再設定＝72バイト以内）。
 * bcrypt の実際の上限は 72 バイトなので、登録では 73 バイト以上が画面を通ってサーバーで拒否された。
 */
const base = { display_name: '合成', email: 'fixture@example.com', phone: '090-1234-5678', prefecture: '東京都', terms_agreed: true };
const signupAccepts = (password: string) => signupSchema.safeParse({ ...base, password, password_confirm: password }).success;
const resetAccepts = (password: string) => resetPasswordSchema.safeParse({ password, password_confirm: password }).success;

test.each([
  ['a'.repeat(PASSWORD_MIN_LENGTH - 1), false], ['a'.repeat(PASSWORD_MIN_LENGTH), true],
  ['a'.repeat(PASSWORD_MAX_BYTES), true], ['a'.repeat(PASSWORD_MAX_BYTES + 1), false],
  ['あ'.repeat(24), true], ['あ'.repeat(25), false], ['a'.repeat(128), false],
])('signup and reset accept exactly the same passwords: %s -> %s', (password, accepted) => {
  expect(newPasswordField.safeParse(password).success).toBe(accepted);
  expect(signupAccepts(password)).toBe(accepted);
  expect(resetAccepts(password)).toBe(accepted);
});

test('the hint states the real limits', () => {
  expect(PASSWORD_RULES_HINT).toContain(`${PASSWORD_MIN_LENGTH}文字以上`);
  expect(PASSWORD_RULES_HINT).toContain('半角72文字以内');
  expect(PASSWORD_RULES_HINT).not.toContain('128');
});
