/**
 * 店舗の電話番号を tel: リンクにしてよいかの単一の判定（店舗ページ・マイページの予約詳細・LIFF のキャンセル画面）。
 * 電話番号は店舗の自由入力なので、数字・+・-・()・#・半角スペースだけの 7〜20 文字のときだけリンクにする
 * （tel: に任意の文字列を入れない）。以前は店舗ページの 3 か所に同じ正規表現を直書きしていた。
 */
const DIALABLE_PHONE = /^[0-9+\-()# ]{7,20}$/;

export function isDialablePhone(phone: unknown): phone is string {
  return typeof phone === 'string' && DIALABLE_PHONE.test(phone);
}

/**
 * お客様向け予約メールに載せる店舗の連絡先（電話番号・店舗ページの slug）。
 * 電話番号は isDialablePhone を通ったものだけ、slug は公開中の店舗のときだけ返す（非公開の店舗ページは 404 になる）。
 * 店舗の行を読めなかったときは両方 null（連絡先が無くても、メールは店名で「直接ご連絡ください」と案内できる）。
 */
export function bookingEmailShopContact(facility: { slug?: string | null; phone?: string | null; status?: string | null } | null | undefined): {
  facilityPhone: string | null; facilitySlug: string | null;
} {
  const phone = facility?.phone;
  return {
    facilityPhone: isDialablePhone(phone) ? phone : null,
    facilitySlug: facility?.status === 'published' && facility.slug ? facility.slug : null,
  };
}
