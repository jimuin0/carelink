import { z } from 'zod';

/**
 * 新しいパスワード（新規登録・パスワード再設定）の条件の単一ソース。
 *
 * 以前は新規登録が「8〜128文字」、再設定が「8文字以上・72バイト以内」と別々の条件を持っていた。
 * 実際の上限は Supabase Auth（bcrypt）の 72 バイトなので、新規登録で 73 バイト以上を入れると
 * 画面では通ってサーバーで拒否されていた。入力欄の案内・送信前の検証・maxLength は全てここを見る。
 */

/**
 * パスワードの最低文字数。本番の Supabase Auth の設定（最低 8 文字＋流出パスワードの拒否・
 * 文字種の指定なし）と揃える。ここ以外に 8 を書かない（ずれると案内と実際の条件が食い違う）。
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Supabase Auth（bcrypt）が受け付けるパスワードの上限。文字数ではなく UTF-8 のバイト数で数える。
 * 超えると送信後にサーバーで拒否されるため、送信前に止めて理由を伝える。
 * 入力欄の maxLength もこの値（半角のみなら 72 文字まで入る。全角はバイト数の検証で止める）。
 */
export const PASSWORD_MAX_BYTES = 72;

/** 入力欄の下に出す条件の説明（新規登録・再設定で同じ文言）。 */
export const PASSWORD_RULES_HINT =
  `${PASSWORD_MIN_LENGTH}文字以上で入力してください。英字・数字・記号を組み合わせる必要はありません。`;

export const PASSWORD_TOO_SHORT_MESSAGE = `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください`;

export const PASSWORD_TOO_LONG_MESSAGE =
  'パスワードが長すぎます。文字数を減らしてください（半角英数字・記号のみの場合は72文字まで）。';

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

/** 新しく設定するパスワード 1 欄分の検証（新規登録・再設定の共通）。 */
export const newPasswordField = z.string()
  .min(PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE)
  .refine(value => utf8ByteLength(value) <= PASSWORD_MAX_BYTES, PASSWORD_TOO_LONG_MESSAGE);
