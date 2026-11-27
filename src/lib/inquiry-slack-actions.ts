/**
 * 未完了の問い合わせを Slack のボタンから「解決済み」にする（2026年11月27日 神原さん指示）。
 *
 * 毎朝の未完了通知（inquiry-backlog.ts）の後に、1件ごとに「解決済みにする」ボタンを付けた
 * メッセージを出す。解決済みにするまで毎朝通知が続く（自動で閉じることはしない＝神原さん決定）。
 *
 * 🔴 押した人の確認（だれでも閉じられないように）:
 *   Slack の署名（/api/slack/interactions で検証）で「CareLink の Slack アプリ経由の操作」であることを確かめたうえで、
 *   押した Slack ユーザーのメールアドレスを users.info で引き、CareLink の profiles（email_canonical）で
 *   1人に決まり、かつ is_platform_admin のときだけ処理する。管理者判定は管理画面と同じ RPC
 *   manage_platform_control_atomic（DB 側で is_platform_admin を確かめる）に任せる。
 *   メールが取れない（users:read.email の権限が無い等）・一致しない・複数一致は、何も変えずに理由だけ返す。
 */
import type { createServiceRoleClient } from './supabase-server';
import { actionsBlock, buttonElement, getSlackUserEmail, linkButtonElement, postToSlack, respondToSlackAction, sectionBlock } from './slack';
import { writeAuditLog } from './audit-logger';
import { canonicalizeEmail } from './email-canonical';

type DB = ReturnType<typeof createServiceRoleClient>;

export const INQUIRY_RESOLVE_ACTION_ID = 'inquiry_resolve';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 1通に載せる件数（Slack は 1 メッセージ 50 ブロックまで。1件 2 ブロック＋見出し・リンク）。超えた分は次の1通に続ける。 */
export const MAX_BUTTON_ITEMS = 20;
/** 送り直すまでの待ち時間（Slack の chat.postMessage はチャンネルあたり毎秒1通程度まで）。 */
export const RETRY_WAIT_MS = 1500;
/** 待ちの上限（cron の実行時間を延ばしすぎない。超える指定でも欠けた件は翌朝の通知に出る）。 */
export const MAX_RETRY_WAIT_MS = 30_000;

export interface ResolvableLine { id: string; label: string }

/** ボタン付きメッセージ1通分の blocks を作る（純粋関数）。label は送る前の伏せ字処理を通したもの。 */
export function buildInquiryResolveBlocks(lines: ResolvableLine[], adminUrl: string, page = { index: 1, total: 1 }): Record<string, unknown>[] {
  const heading = page.total > 1 ? `*未完了のお問い合わせ（${page.index}/${page.total}）*` : '*未完了のお問い合わせ*';
  const blocks: Record<string, unknown>[] = [
    sectionBlock(`${heading}（対応が済んだものは「解決済みにする」を押してください。解決済みにするまで毎朝お知らせします）`),
  ];
  for (const line of lines.slice(0, MAX_BUTTON_ITEMS)) {
    blocks.push(sectionBlock(line.label));
    blocks.push(actionsBlock([buttonElement('解決済みにする', INQUIRY_RESOLVE_ACTION_ID, line.id, 'primary')]));
  }
  blocks.push(actionsBlock([linkButtonElement('問い合わせ管理を開く', adminUrl)]));
  return blocks;
}

/**
 * ボタン付きメッセージを送る。全件にボタンが付くよう、MAX_BUTTON_ITEMS 件ごとに分けて送る
 * （上限で切ると、古い件が残り続ける間は新しい件に毎日ボタンが付かない・Codex 指摘 PR996-03）。
 * 失敗しても throw しない（文章の通知は別に出ている）。全通送れたら true。
 */
export async function postInquiryResolveButtons(lines: ResolvableLine[], adminUrl: string): Promise<boolean> {
  if (lines.length === 0) return false;
  const total = Math.ceil(lines.length / MAX_BUTTON_ITEMS);
  let allOk = true;
  for (let index = 0; index < total; index += 1) {
    const chunk = lines.slice(index * MAX_BUTTON_ITEMS, (index + 1) * MAX_BUTTON_ITEMS);
    const send = () => postToSlack({ text: `未完了のお問い合わせ ${lines.length}件（ボタンで解決済みにできます）`, blocks: buildInquiryResolveBlocks(chunk, adminUrl, { index: index + 1, total }), unfurl_links: false });
    try {
      let result = await send();
      // 一時的な失敗（Slack のレート制限 http_429 等）で一部の通だけ欠けないよう、少し待って 1 回だけ送り直す（Codex 指摘 PR996-04）。
      // 送り直しても欠けた件は、解決済みになるまで翌朝も通知に出る。
      if (!result.ok && result.error !== 'preview_read_only' && result.error !== 'not_configured' && result.error !== 'no_channel') {
        // Slack が待ち秒数（Retry-After）を示したらそれに従う（上限 MAX_RETRY_WAIT_MS・Codex 指摘 PR996-04 再検査）
        const waitMs = Math.min(Math.max(RETRY_WAIT_MS, (result.retryAfterSec ?? 0) * 1000), MAX_RETRY_WAIT_MS);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        result = await send();
      }
      if (!result.ok) { allOk = false; console.error('[inquiry-slack] button post failed:', result.error); }
    } catch {
      allOk = false;
      console.error('[inquiry-slack] button post failed:', 'notification_failure');
    }
  }
  return allOk;
}

export interface ResolvePayload {
  user?: { id?: string };
  response_url?: string;
}

export type ResolveOutcome = 'resolved' | 'invalid' | 'no_email' | 'not_admin' | 'not_found' | 'failed';

const OUTCOME_TEXT: Record<Exclude<ResolveOutcome, 'resolved'>, string> = {
  invalid: '操作の内容を読み取れませんでした。問い合わせ管理の画面から処理してください。',
  no_email: 'Slack のメールアドレスを確認できませんでした。問い合わせ管理の画面から処理してください。',
  not_admin: 'この操作は CareLink の運営管理者だけができます（Slack のメールアドレスが運営管理者のアカウントと一致しません）。',
  not_found: 'その問い合わせが見つかりませんでした。',
  failed: '解決済みにできませんでした。問い合わせ管理の画面から処理してください。',
};

/** 「解決済みにする」ボタンの処理本体。 */
export async function resolveInquiryFromSlack(db: DB, payload: ResolvePayload, contactId: string | undefined): Promise<ResolveOutcome> {
  const outcome = await decide(db, payload, contactId);
  await respondToSlackAction(payload.response_url, outcome === 'resolved' ? '✅ 解決済みにしました。明日から通知に出ません。' : OUTCOME_TEXT[outcome]);
  return outcome;
}

async function decide(db: DB, payload: ResolvePayload, contactId: string | undefined): Promise<ResolveOutcome> {
  const slackUserId = payload.user?.id;
  if (!contactId || !UUID_RE.test(contactId) || !slackUserId) return 'invalid';
  const email = await getSlackUserEmail(slackUserId);
  if (!email) return 'no_email';
  const { data: admins, error: lookupError } = await db.from('profiles').select('id').eq('email_canonical', canonicalizeEmail(email)).eq('is_platform_admin', true).limit(2);
  if (lookupError) return 'failed';
  if (!admins || admins.length !== 1) return 'not_admin';
  const actorId = (admins[0] as { id: string }).id;
  const { data, error } = await db.rpc('manage_platform_control_atomic', { p_actor_id: actorId, p_record_id: contactId, p_kind: 'ticket:update', p_values: { ticket_status: 'resolved' } });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === 'P0002') return 'not_found';
    if (code === '42501') return 'not_admin';
    return 'failed';
  }
  void writeAuditLog({
    userId: actorId,
    action: 'update',
    tableName: 'contacts',
    recordId: contactId,
    newValues: { ticket_status: 'resolved', resolved_at: (data as { resolved_at?: string | null } | null)?.resolved_at ?? null, via: 'slack', slack_user_id: slackUserId },
  });
  return 'resolved';
}
