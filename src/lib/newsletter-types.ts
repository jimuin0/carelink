/**
 * 運営ニュースレターで【新しく作成できる】種別（2026年10月23日）。
 *
 * 🔴 宛先を作る経路があるのは施設オーナー向け（owner_monthly）だけ。
 * 『ユーザーダイジェスト（user_digest）／クーポン配信（user_coupon）／プロモーション（promo）』は、
 * 宛先になる有効な購読行（newsletter_subscriptions の user_digest / all）をどこからも作れないため、
 * 作って「今すぐ配信」を押しても必ず「配信対象がありません」で終わっていた。
 * マイページの「お知らせメールを受け取る」を宛先に流用することはしない（既定 ON で、登録時に広告メールへの
 * 同意を取っていない。特定電子メール法は事前の同意（オプトイン）を求める）。
 *
 * 旧種別のキャンペーンは一覧の表示のためにラベルを残す（newsletters/page.tsx）。DB の CHECK も変えない。
 */
export const NEWSLETTER_CREATABLE_TYPES: readonly string[] = ['owner_monthly'];

/** 作成画面・作成 API で受け付ける種別か。 */
export function isCreatableNewsletterType(value: unknown): boolean {
  return typeof value === 'string' && NEWSLETTER_CREATABLE_TYPES.includes(value);
}

/** 作成できない種別を指定されたときの説明（作成 API の 400 応答）。 */
export const NEWSLETTER_TYPE_UNAVAILABLE_MESSAGE =
  'この種別は配信先がないため作成できません。ニュースレターは施設オーナー向けのみ作成できます。';
