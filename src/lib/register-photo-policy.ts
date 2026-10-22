/**
 * 掲載申込（/register）での「写真は必要か」の説明の単一ソース。
 *
 * 🔴 なぜ 1 か所に集めるか: 申込フォームは「公開時には写真の設定が必要です」と書き、
 * 同じページの FAQ は「無料掲載に写真は必須ではありません」と書いていた（矛盾）。
 * 実際の判定は src/lib/facility-publish-gate.ts で、掲載公開は施設名・所在地だけを見ており、
 * 写真（1枚以上）を求めるのはネット予約の条件（bookingReadinessChecks の 'photo'）だけ。
 * 文言を散らすと、判定を変えたときに必ずどこかが古くなる。
 */

/** ネット予約に必要な写真の枚数（facility-publish-gate.ts の photoCount >= 1 と同じ）。 */
export const BOOKING_MIN_PHOTOS = 1;

/** 申込フォームで受け付ける写真の最大枚数。 */
export const REGISTER_MAX_PHOTOS = 7;

/** 写真の要否を一文で。FAQ・フォームの両方がこれを使う。 */
export const REGISTER_PHOTO_REQUIREMENT = `写真がなくても掲載公開できます。ネット予約を始めるには写真が${BOOKING_MIN_PHOTOS}枚以上必要です。`;

/** 申込フォームの写真欄に添える注記。 */
export const REGISTER_PHOTO_FIELD_NOTE = `任意・最大${REGISTER_MAX_PHOTOS}枚。${REGISTER_PHOTO_REQUIREMENT}`;
