/**
 * 紹介コードの形・共有リンク・利用条件の単一ソース。
 *
 * - コードは /api/referral が発行する 8 文字（I・O・0・1 を除く英大文字と数字）。
 * - 共有リンク（トップの `?ref=コード`）は、ログイン後の入力画面
 *   `/mypage/referral?ref=コード` まで運んで入力欄へ事前入力する。
 *   未ログインのまま /mypage へ直接飛ばすと、middleware が戻り先からクエリを落とすため、
 *   会員登録・ログイン画面の `?redirect=` に入力画面のパスを載せて運ぶ。
 * - 紹介ボーナスは「初回のご予約完了」で付与する。来店済みの方のコード入力は
 *   DB（apply_referral_code_atomic）が REFERRAL_NOT_ELIGIBLE で断る。
 */

export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;

const CODE_PATTERN = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

/** URL の `?ref=` の値を紹介コードとして受け取る。形が合わなければ null（入力欄へ入れない）。 */
export function referralCodeFromParam(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** 紹介コードを入力する画面（ログイン後）。 */
export function referralEntryPath(code: string): string {
  return `/mypage/referral?ref=${encodeURIComponent(code)}`;
}

/** 会員登録してから入力画面へ進むリンク。ログイン済みなら middleware がそのまま入力画面へ送る。 */
export function referralSignupHref(code: string): string {
  return `/auth/signup?redirect=${encodeURIComponent(referralEntryPath(code))}`;
}

/** ログインしてから入力画面へ進むリンク。 */
export function referralLoginHref(code: string): string {
  return `/auth/login?redirect=${encodeURIComponent(referralEntryPath(code))}`;
}

/** 来店済み（完了した予約がある）方がコードを入力したときの案内（REFERRAL_NOT_ELIGIBLE）。 */
export const REFERRAL_NOT_ELIGIBLE_MESSAGE = '紹介コードは初回のご来店前の方のみご利用いただけます。';

/** 紹介された方（友達）へのポイント（award_referral_points_atomic の 紹介コード利用ボーナス）。 */
export const REFERRAL_REFERRED_POINTS = 300;

/**
 * X・LINE で友達へ送る共有文。友達が最初に読む文なので、利用条件（初回のご予約の前に入力）と
 * 付与の時点（初回のご予約完了）を必ず書く。条件を書かないと、来店済みの友達は入力してから
 * REFERRAL_NOT_ELIGIBLE で断られるまで条件を知る機会が無い。
 */
export function referralShareText(code: string): string {
  return `CareLinkで健康・美容施設を予約しよう！初回のご予約の前に紹介コード「${code}」を入力すると、初回のご予約完了で${REFERRAL_REFERRED_POINTS}ポイントもらえます🎁`;
}
