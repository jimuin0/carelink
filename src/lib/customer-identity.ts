import { canonicalizeEmail } from './email-canonical';

/**
 * 顧客の「同じ人か」を決めるキー（来店履歴・顧客台帳・RFM セグメントの突合で使う単一ソース）。
 *
 * - メールがあれば canonicalizeEmail（Gmail のドット・+タグを同じ人にまとめる）
 * - メールが無く電話番号があれば 'tel:' ＋ 数字だけ（ハイフン・空白・全角数字の表記ゆれを吸収）
 * - どちらも無ければ null（名前だけで別の人をまとめない）
 *
 * 【なぜ電話番号も見るか】電話・来店受付の予約はメール欄が任意で、空欄のまま完了にすると
 * 来店記録（customer_visits）の customer_email が NULL になる。以前はメールでしか突合しなかったため、
 * そうした来店は顧客管理のどこにも出ず、電話番号だけで台帳に登録したお客様は来店 0 回のままだった。
 *
 * 【電話番号は 10 桁以上だけを使う】日本の電話番号は市外局番から 10〜11 桁。「0」「1234」のような
 * 仮の入力で別の人がまとまらないよう、それより短いものは識別に使わない。
 *
 * 【メールがある予約は電話番号では突合しない】家族で 1 つの電話番号を使う場合などに、
 * 別の人の来店を混ぜないため（メールは本人ごとに分かれる）。
 * 逆向き（メールの無い来店を、メールと電話番号で台帳に登録したお客様へ寄せる）は、
 * 台帳でその電話番号を持つのが 1 人だけのときに限って行う（下の ledgerPhoneLinks）。
 *
 * 🔴 DB 側の public.customer_phone_digits（supabase/migrations/20261023090000_customer_phone_identity.sql）と
 *   同じ規則にしてある。片方だけ変えると、一覧（DB で集計）と台帳（ここで突合）と詳細（DB で照会）で
 *   同じお客様が別人扱いになる。src/__tests__/customer-phone-identity.test.ts が両者の一致を固定している。
 */
export const PHONE_KEY_PREFIX = 'tel:';
export const MIN_PHONE_DIGITS = 10;

/** 全角数字 → 半角数字の対応（DB 側の translate と同じ並び）。 */
export const FULLWIDTH_DIGITS = '０１２３４５６７８９';

/** 電話番号を数字だけにする。10 桁未満（仮の入力など）は識別に使えないので null。 */
export function phoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone
    .replace(/[０-９]/g, (c) => String(FULLWIDTH_DIGITS.indexOf(c)))
    .replace(/[^0-9]/g, '');
  return digits.length >= MIN_PHONE_DIGITS ? digits : null;
}

/** 突合キー。メール優先、メールが無ければ電話番号、どちらも無ければ null。 */
export function customerIdentityKey(email: string | null | undefined, phone: string | null | undefined): string | null {
  if (email && email.trim()) return canonicalizeEmail(email);
  const digits = phoneDigits(phone);
  return digits ? `${PHONE_KEY_PREFIX}${digits}` : null;
}

/** 電話番号だけのキー（'tel:数字'）。識別に使えない電話番号は null。 */
export function phoneIdentityKey(phone: string | null | undefined): string | null {
  return customerIdentityKey(null, phone);
}

/**
 * 台帳にメールと電話番号の両方で登録したお客様へ、その電話番号のメール無し来店（電話・来店受付）を
 * 寄せるための対応表。'tel:数字' → そのお客様のメールのキー（canonical）。
 *
 * 【なぜ要るか】台帳のキーはメール優先なので、メールのあるお客様の電話予約（メール欄が空）は
 * 'tel:数字' という別の人として集計され、本人の来店回数・最終来店・RFM に入らなかった。
 * しかも「来店履歴から未登録のお客様」に同じ氏名・同じ電話番号の行が出て、「＋ 登録」で重複登録できた。
 *
 * 【寄せるのは 1 施設の台帳でその電話番号を持つお客様が 1 人だけのとき】2 人以上（家族で 1 つの
 * 電話番号を使う等）なら誰の来店か決められないので寄せない。電話番号だけのお客様がその番号を持つ
 * 場合も 2 人目として数えるので寄せない（その来店は電話番号だけのお客様のもの）。
 *
 * 一覧（customer-directory.ts）・顧客詳細（admin.ts の getLedgerCustomerVisits）・RFM の cron が
 * すべてこの表を使う。片方だけ寄せると一覧と詳細で来店回数が食い違う。
 */
export function ledgerPhoneLinks(ledger: ReadonlyArray<{ email: string | null; phone: string | null }>): Map<string, string> {
  const owners = new Map<string, Array<string | null>>();
  for (const c of ledger) {
    const telKey = phoneIdentityKey(c.phone);
    if (!telKey) continue;
    const emailKey = c.email && c.email.trim() ? canonicalizeEmail(c.email) : null;
    owners.set(telKey, [...(owners.get(telKey) ?? []), emailKey]);
  }
  const links = new Map<string, string>();
  for (const [telKey, emails] of owners) {
    if (emails.length === 1 && emails[0]) links.set(telKey, emails[0]);
  }
  return links;
}
