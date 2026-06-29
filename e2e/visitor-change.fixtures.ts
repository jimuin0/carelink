// 来院者（一般ユーザー）の予約日時変更 E2E の共有定数。
// visitor-change.setup.ts が CI の隔離 Supabase（supabase start）に予約可能施設＋来院者＋
// その本人名義の変更可能な予約を service role で seed し、visitor-change.spec.ts が実 UI 上で
// 日時変更（新しい日付・空き枠を選んで変更）の書き込みを検証する。本番には一切触れない。

export const VISITOR_CHANGE_AUTH_FILE = 'e2e/.auth/visitor-change.json';
// setup が seed した「変更対象の予約」の id を書き出すファイル（spec が読んで変更ページを開く）。
export const VISITOR_CHANGE_BOOKING_FILE = 'e2e/.auth/visitor-change-booking.json';

export const VISITOR_CHANGE_SEED = {
  staffName: '変更E2Eスタッフ',
  menuName: '変更E2Eメニュー',
  customerName: 'E2E変更来院者',
};
