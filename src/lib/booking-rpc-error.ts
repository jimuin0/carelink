/**
 * 予約 RPC の RAISE EXCEPTION 文言から判定用のコードを取り出す。
 *
 * create_booking_atomic 系は 'BOOKING_CONFLICT: この時間帯は既に予約が入っています' のように
 * 「コード: 説明」で投げ、ポイント・メニュー検証は 'POINTS_INSUFFICIENT' のようにコードだけで投げる。
 * 以前の /api/booking は文言全体を既知コード表と突き合わせていたため、前者（満席・定休日・営業時間外・
 * スタッフ不在・クーポン上限など）は既知の拒否として扱われず、利用者には 409 ではなく 500
 * 「受付結果を確認できません」が返っていた。
 */
export function bookingRpcErrorCode(message: unknown): string {
  if (typeof message !== 'string') return '';
  const colon = message.indexOf(':');
  return (colon === -1 ? message : message.slice(0, colon)).trim();
}

/**
 * 既知コードに対応する利用者向け文言。表に無いコード（Object.prototype のキーを含む）は undefined。
 * 文言表は呼び出し側が持つ（作成と変更で案内が違うため）。
 */
export function knownBookingRpcMessage(message: unknown, known: Readonly<Record<string, string>>): string | undefined {
  const code = bookingRpcErrorCode(message);
  return Object.prototype.hasOwnProperty.call(known, code) ? known[code] : undefined;
}
