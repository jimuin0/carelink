import { z } from 'zod';
import { newPasswordField, PASSWORD_MIN_LENGTH } from './password-policy';

/**
 * パスワード再設定（/auth/reset-password）の入力検証と、更新失敗時の案内文。
 *
 * 以前は updateUser のエラーを種類に関係なく「リンクの有効期限が切れている可能性があります」と
 * 表示していた。流出済みパスワード（pwned）・前回と同じパスワード・長すぎるパスワードでも
 * 同じ文言になり、利用者は再設定メールを何度も申請し直すだけで原因に辿り着けなかった。
 */

// 条件（最低文字数・72バイト上限・案内文）は新規登録と同じ単一ソースから取る。
// 既存の import 先（このファイル）を壊さないよう再 export する。
export {
  PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES, PASSWORD_RULES_HINT, PASSWORD_TOO_LONG_MESSAGE, utf8ByteLength,
} from './password-policy';

export const resetPasswordSchema = z.object({
  password: newPasswordField,
  password_confirm: z.string(),
}).refine((data) => data.password === data.password_confirm, {
  message: 'パスワードが一致しません',
  path: ['password_confirm'],
});

export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export type PasswordUpdateFailure = {
  message: string;
  /** true のとき、再設定の申請し直し（/auth/forgot-password）への導線を一緒に出す。 */
  requestNewLink: boolean;
};

/** supabase-js の AuthError / AuthWeakPasswordError の、判定に使う部分だけ。 */
export type PasswordUpdateError = {
  name?: string;
  code?: string;
  reasons?: readonly string[];
};

export const PASSWORD_PWNED_MESSAGE =
  'このパスワードは過去に流出したものとして使用できません。別のパスワードを入力してください。';
export const PASSWORD_SAME_MESSAGE = '以前と異なるパスワードを入力してください。';
export const RECOVERY_LINK_EXPIRED_MESSAGE =
  'パスワードの更新に失敗しました。リンクの有効期限が切れている可能性があります。';
export const PASSWORD_UPDATE_RETRY_MESSAGE =
  'パスワードを更新できませんでした。時間をおいてもう一度お試しください。';

// 再設定リンクで作られたセッションが、送信時点で失効・消失していることを示すコード。
const RECOVERY_SESSION_GONE_CODES = new Set([
  'bad_jwt', 'session_not_found', 'session_expired',
  'refresh_token_not_found', 'refresh_token_already_used',
]);

// 案内するのは本番で実際に効いている条件だけにする（最低文字数と流出パスワードの拒否）。
// 以前は本番が求めていない「英字の大文字・小文字・数字・記号を組み合わせて」を出し、
// 実際の最低文字数は伝えていなかった。'characters' は文字種の条件を設定したときだけ
// 返る理由なので、どの種類が必須かを断定しない書き方にしてある。
function weakPasswordMessage(reasons: readonly string[]): string {
  if (reasons.includes('pwned')) return PASSWORD_PWNED_MESSAGE;
  const parts = ['このパスワードは安全性の条件を満たしていません。'];
  if (reasons.includes('length')) parts.push(`${PASSWORD_MIN_LENGTH}文字以上で入力してください。`);
  if (reasons.includes('characters')) parts.push('英字・数字・記号などを組み合わせてください。');
  if (parts.length === 1) parts.push(`${PASSWORD_MIN_LENGTH}文字以上で、過去に流出していないパスワードを入力してください。`);
  return parts.join('');
}

export function describePasswordUpdateError(error: PasswordUpdateError): PasswordUpdateFailure {
  if (error.code === 'weak_password') {
    return { message: weakPasswordMessage(error.reasons ?? []), requestNewLink: false };
  }
  if (error.code === 'same_password') {
    return { message: PASSWORD_SAME_MESSAGE, requestNewLink: false };
  }
  if (error.name === 'AuthSessionMissingError' || RECOVERY_SESSION_GONE_CODES.has(error.code ?? '')) {
    return { message: RECOVERY_LINK_EXPIRED_MESSAGE, requestNewLink: true };
  }
  return { message: PASSWORD_UPDATE_RETRY_MESSAGE, requestNewLink: false };
}
