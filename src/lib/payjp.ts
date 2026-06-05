/**
 * PAY.JP サーバクライアント（Stripe からの移行・Phase 0）
 *
 * 方針: PAY.JP は Stripe Checkout のようなホスト型リダイレクト決済を持たない。
 *   クライアント(payjp.js / PAY.JP Checkout)がカードをトークン化 → サーバが charges.create で
 *   即時課金する同期フロー。本ラッパは秘密鍵をサーバ側でのみ参照し、未設定時は null を返す
 *   （決済機能無効として呼び出し側で 503 等に扱う）。秘密鍵は環境変数 PAYJP_SECRET_KEY に設定する
 *   （会話・コードにベタ書きしない）。
 */
import Payjp from 'payjp';

export type PayjpClient = ReturnType<typeof Payjp>;

/** PAY.JP クライアントを返す。PAYJP_SECRET_KEY 未設定なら null（決済無効）。 */
export function getPayjp(): PayjpClient | null {
  const key = process.env.PAYJP_SECRET_KEY;
  if (!key) return null;
  return Payjp(key);
}

/** 決済機能が利用可能か（秘密鍵が設定されているか）。 */
export function isPayjpConfigured(): boolean {
  return !!process.env.PAYJP_SECRET_KEY;
}
