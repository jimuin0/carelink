/**
 * 店舗の電話番号を tel: リンクにしてよいかの単一の判定（店舗ページ・マイページの予約詳細・LIFF のキャンセル画面）。
 * 電話番号は店舗の自由入力なので、数字・+・-・()・#・半角スペースだけの 7〜20 文字のときだけリンクにする
 * （tel: に任意の文字列を入れない）。以前は店舗ページの 3 か所に同じ正規表現を直書きしていた。
 */
const DIALABLE_PHONE = /^[0-9+\-()# ]{7,20}$/;

export function isDialablePhone(phone: unknown): phone is string {
  return typeof phone === 'string' && DIALABLE_PHONE.test(phone);
}
