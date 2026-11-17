/**
 * 掲載申込の確定（/api/salons/commit）が受け付けられなかったことを運営に知らせる。
 *
 * 2026年9月、2組の店舗（計7店舗）が申込フォームで「入力内容が不正です」「送信に失敗しました」に
 * なったが、申込は1行も残らず、運営は本人が別途問い合わせてくれるまで気づけなかった。
 * 黙って諦めた店舗は今も知りようがない。5xx は withRoute が通知するが、4xx（入力の不一致・
 * 期限切れ・写真の未確認など）はどこにも出ていなかったため、確定を断った事実だけを出す。
 *
 * 🔴 Slack はプライバシーポリシーの委託先に無いため、入力値は一切載せない。
 *    出すのは断った理由の種類と、問題になった欄の「名前」だけ（値・店名・メールは出さない）。
 */
import { alertWarning } from './alert';

/** 申込者の操作で起こり得る拒否。503/202（結果不明）は withRoute と照合経路が扱うので含めない。 */
export const ALERTED_COMMIT_REFUSALS = ['invalid', 'consent_required', 'unverified', 'expired', 'conflict', 'photo_unverified'] as const;
type AlertedRefusal = (typeof ALERTED_COMMIT_REFUSALS)[number];

function isAlerted(state: string): state is AlertedRefusal {
  return (ALERTED_COMMIT_REFUSALS as readonly string[]).includes(state);
}

export function alertSalonCommitRefusal(state: string, fieldErrors?: Record<string, unknown> | null): void {
  if (!isAlerted(state)) return;
  const fields = fieldErrors ? Object.keys(fieldErrors).sort() : [];
  alertWarning(`掲載申込の送信が受け付けられませんでした（${state}）。この送信は保存していません（以前の申込が保存済みの場合はあります）`, {
    category: '完了未確認',
    route: '/api/salons/commit',
    status: state === 'conflict' || state === 'photo_unverified' ? 409 : state === 'expired' ? 410 : state === 'unverified' ? 403 : 400,
    extra: { state, fields: fields.length > 0 ? fields.join(',') : 'なし' },
  });
}
