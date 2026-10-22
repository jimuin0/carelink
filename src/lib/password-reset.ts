import { z } from 'zod';

/**
 * パスワード再設定（/auth/reset-password）の入力検証と、更新失敗時の案内文。
 *
 * 以前は updateUser のエラーを種類に関係なく「リンクの有効期限が切れている可能性があります」と
 * 表示していた。流出済みパスワード（pwned）・前回と同じパスワード・長すぎるパスワードでも
 * 同じ文言になり、利用者は再設定メールを何度も申請し直すだけで原因に辿り着けなかった。
 */

/**
 * Supabase Auth（bcrypt）が受け付けるパスワードの上限。文字数ではなく UTF-8 のバイト数で数える。
 * 超えると送信後にサーバーで拒否されるため、送信前に止めて理由を伝える。
 */
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_TOO_LONG_MESSAGE =
  'パスワードが長すぎます。半角英数字・記号なら72文字以内にしてください（全角文字は1文字を3文字分として数えます）。';

/**
 * UTF-8 でのバイト数。TextEncoder と同じ結果を返す（対になっていないサロゲートは
 * 置換文字 U+FFFD＝3 バイトとして数える）。TextEncoder を使わないのは、テスト環境（jsdom）に
 * 無く、フォームの検証そのものが例外で止まるため。
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) as number;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export const resetPasswordSchema = z.object({
  password: z.string()
    .min(8, 'パスワードは8文字以上で入力してください')
    .refine(value => utf8ByteLength(value) <= PASSWORD_MAX_BYTES, PASSWORD_TOO_LONG_MESSAGE),
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

function weakPasswordMessage(reasons: readonly string[]): string {
  if (reasons.includes('pwned')) return PASSWORD_PWNED_MESSAGE;
  const parts = ['このパスワードは安全性の条件を満たしていません。'];
  if (reasons.includes('length')) parts.push('より長いパスワードを入力してください。');
  if (reasons.includes('characters')) parts.push('英字の大文字・小文字・数字・記号を組み合わせてください。');
  if (parts.length === 1) parts.push('8文字以上で、英字の大文字・小文字・数字・記号を組み合わせてください。');
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
