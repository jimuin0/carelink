/**
 * 訪問専門の店舗かどうか。施設の「こだわり条件」(features) に「訪問専門」がある店舗は、
 * 来店先が無く施術者が利用者の自宅へ伺うため、予約時に訪問先の住所が必須になる。
 * 予約フォーム（表示と送信前チェック）と /api/booking（受付時の検証）が同じ判定を使う。
 */
export const HOME_VISIT_ONLY_FEATURE = '訪問専門';

export function isHomeVisitOnly(features: unknown): boolean {
  return Array.isArray(features) && features.includes(HOME_VISIT_ONLY_FEATURE);
}

export const HOME_VISIT_ADDRESS_REQUIRED_MESSAGE = '訪問先のご住所を入力してください';
