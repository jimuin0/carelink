/**
 * 掲載までの 4 ステップの単一ソース。
 *
 * 以前は同じ流れをトップ（3 手順）・/register/guide（4 手順）・承認メール（種類ごとに中身が違う 3 手順）
 * ・ウェルカムメールなど 8 か所で別々の文章で書いており、手順の数まで食い違っていた。
 * 画面の図（RegistrationFlow）とメールの見出しは、どちらもここの title を使う。
 */
/** parts は狭い幅で折り返してよい位置（語の途中で「アカウン／ト作成」と割れないように）。parts を連結すると title になる。 */
export const REGISTRATION_STEPS = [
  { key: 'apply', title: '申し込む', parts: ['申し込む'], detail: '店舗の情報を入力して送信' },
  { key: 'account', title: 'アカウント作成', parts: ['アカウント', '作成'], detail: '申込と同じメールアドレスで' },
  { key: 'documents', title: '書類の提出', parts: ['書類の', '提出'], detail: '店舗を確認できる書類を1点' },
  { key: 'publish', title: '公開', parts: ['公開'], detail: '運営の確認後、営業時間などが揃えば公開' },
] as const;

export type RegistrationStepKey = typeof REGISTRATION_STEPS[number]['key'];

/** メール本文の見出し（例：「【3】書類の提出」）。済んだ手順には「（済）」を付ける。 */
export function registrationStepHeading(key: RegistrationStepKey, done = false): string {
  const index = REGISTRATION_STEPS.findIndex(step => step.key === key);
  return `【${index + 1}】${REGISTRATION_STEPS[index].title}${done ? '（済）' : ''}`;
}
