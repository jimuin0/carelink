/**
 * 運営宛お問い合わせ（contacts）の対応漏れを毎日 Slack に出す。
 *
 * 2026年11月に、4件しかない問い合わせのうち3件が「こちらの返事待ち」のまま
 * 2か月放置されていたことが分かった（返信が CareLink の外から送られた・状態が更新されない・
 * 「復旧したら連絡します」の続きが下書きのまま）。人が状態を付け忘れても気づけるよう、
 * 未完了の問い合わせを機械的に数えて毎日知らせる。
 *
 * - unreplied: CareLink から返信が送られた記録が無いまま UNREPLIED_DAYS 日以上たったもの
 * - repliedOpen: 返信の記録はあるが、REPLIED_OPEN_DAYS 日以上たっても完了になっていないもの
 *   （相手の返事待ち・CareLink の外でのやり取り・閉じ忘れのどれか。人が確かめて閉じる）
 *
 * 載せるのは、お名前・受付日・問い合わせの種類・管理画面のタブ・経過日数。
 * 運営が Slack だけでどの問い合わせかを判別できるよう、お名前を載せる（2026年11月26日 神原さん決定。
 * プライバシーポリシー第5条に Slack を委託先として追記済み）。
 * 🔴 メール・電話・本文は載せない（判別に要らない。本文には症状が書かれやすい）。中身は /admin/inquiries で見る。
 * 種類は API が任意の文字列を受け付けるため、フォームの選択肢（INQUIRY_TYPE_OPTIONS）に
 * 一致するものだけを出す。それ以外は「その他の種類」にし、保存値をそのまま Slack へ流さない。
 * 受付番号は載せない（数字だけの並びは alert.ts の電話番号マスクに消され、照合に使えないため）。
 */
import type { createServiceRoleClient } from './supabase-server';
import { alertWarning } from './alert';
import { fetchAllPaged } from './paginate';
import { readMailReplyEvidence } from './platform-mail-read';
import { summarizeMailReplies, type LegacyMailReply } from './platform-mail-contract';

type DB = ReturnType<typeof createServiceRoleClient>;
type Evidence = Awaited<ReturnType<typeof readMailReplyEvidence>>;

/**
 * 通知は日本時間の朝9時台の前半に1回だけ出す（2026年11月26日 神原さん決定「朝9時」）。
 * 毎時 7・37 分に動く cron-heartbeat に相乗りし、9:07 の回だけが当たる（9:37 の回は外れる）。
 * 専用の cron を足さないのは、時刻表（cron-jobs.data.json）と運用文書の更新を伴わずに済ませるため。
 */
export function isInquiryBacklogReportTime(now: Date): boolean {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCHours() === 9 && jst.getUTCMinutes() < 30;
}

export const UNREPLIED_DAYS = 1;
export const REPLIED_OPEN_DAYS = 7;
const OPEN_STATUSES = ['open', 'in_progress', 'waiting'] as const;
const EVIDENCE_CHUNK = 100;
const LISTED_ITEMS = 10; // Slack の本文は 1500 文字で切れるため（alert.ts）。超えた分は omitted に数える
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BacklogContact { id: string; created_at: string | null; name?: string | null; ticket_status?: string | null; inquiry_type?: string | null }
export interface BacklogItem {
  id: string; ageDays: number; reason: 'unreplied' | 'repliedOpen';
  name?: string | null; createdAt?: string | null; ticketStatus?: string | null; inquiryType?: string | null;
}

/** お問い合わせフォーム（src/app/contact/page.tsx）の種類の選択肢。テストがフォームと突合する。 */
export const INQUIRY_TYPE_OPTIONS = ['検索・予約について', 'アカウントについて', '施設掲載について（オーナー向け）', 'その他'] as const;

/** 管理画面（/admin/inquiries）のタブ名。そのタブを開けば該当の問い合わせが見つかる。 */
const STATUS_TABS: Record<string, string> = { open: '新着', in_progress: '対応中', waiting: '返信待ち' };

/** 経過日数（切り捨て）。作成日時が無い行は古いものとして扱い、漏れ側に倒す。 */
function ageInDays(createdAt: string | null, now: Date): number {
  if (createdAt === null) return Number.MAX_SAFE_INTEGER;
  return Math.floor((now.getTime() - new Date(createdAt).getTime()) / DAY_MS);
}

/** 純粋関数：未完了の問い合わせと返信の記録から、知らせるべきものを古い順に返す。 */
export function classifyInquiryBacklog(contacts: BacklogContact[], evidence: Evidence, now: Date): BacklogItem[] {
  const items: BacklogItem[] = [];
  for (const contact of contacts) {
    const summary = summarizeMailReplies(
      evidence.messages.filter((mail) => mail.contact_id === contact.id),
      evidence.replies.filter((reply: LegacyMailReply) => reply.contact_id === contact.id),
    );
    const ageDays = ageInDays(contact.created_at, now);
    const detail = { name: contact.name ?? null, createdAt: contact.created_at, ticketStatus: contact.ticket_status ?? null, inquiryType: contact.inquiry_type ?? null };
    if (!summary.replied && ageDays >= UNREPLIED_DAYS) items.push({ id: contact.id, ageDays, reason: 'unreplied', ...detail });
    else if (summary.replied && ageDays >= REPLIED_OPEN_DAYS) items.push({ id: contact.id, ageDays, reason: 'repliedOpen', ...detail });
  }
  return items.sort((a, b) => b.ageDays - a.ageDays);
}

/** 受付日を日本時間の「M/D」で返す。 */
function receivedOn(createdAt: string | null | undefined): string {
  if (!createdAt) return '受付日不明';
  const jst = new Date(new Date(createdAt).getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}受付`;
}

function typeLabel(inquiryType: string | null | undefined): string {
  if (!inquiryType) return '種類不明';
  return (INQUIRY_TYPE_OPTIONS as readonly string[]).includes(inquiryType) ? inquiryType : 'その他の種類';
}

/**
 * お名前は 20 文字（コードポイント単位・サロゲートペアを壊さない）で切る。
 * フォームの名前欄は自由入力なので、全角を半角へ正規化したうえで、数字や「@」を含むもの
 * （電話番号・メールアドレスの書き込み。数字はアラビア数字なども含む Unicode の数字すべて）は載せずに管理画面で確認してもらう。
 * 切ってからではなく、切る前の全文で判定する（切った後だとメールの一部が判定をすり抜けるため）。
 */
const NAME_MAX = 20;
function nameLabel(name: string | null | undefined): string {
  const normalized = (name ?? '').normalize('NFKC').trim();
  if (!normalized) return 'お名前なし';
  if (/[\p{Nd}@]/u.test(normalized)) return 'お名前は管理画面で確認';
  const chars = Array.from(normalized);
  return `${chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX).join('')}…` : normalized}様`;
}

/** 例：「池田 拓郎様・9/22受付・施設掲載について（オーナー向け）・新着タブ（64日）」 */
function formatItem(item: BacklogItem): string {
  const days = item.ageDays === Number.MAX_SAFE_INTEGER ? '日時不明' : `${item.ageDays}日`;
  const tab = (item.ticketStatus && STATUS_TABS[item.ticketStatus]) || '状態不明';
  return `${[nameLabel(item.name), receivedOn(item.createdAt), typeLabel(item.inquiryType), `${tab}タブ`].join('・')}（${days}）`;
}

/**
 * 未完了の問い合わせを数え、知らせるものがあれば Slack に 1 通出す。
 * 取得に失敗したら throw する（「0件」と区別できないまま黙らないため。呼び出し側の cron で記録する）。
 */
export async function reportInquiryBacklog(db: DB, now: Date = new Date()): Promise<{ unreplied: number; repliedOpen: number }> {
  const { rows, error } = await fetchAllPaged<BacklogContact>(async (offset, limit) => {
    const result = await db.from('contacts').select('id,created_at,name,ticket_status,inquiry_type')
      .in('ticket_status', [...OPEN_STATUSES]).is('resolved_at', null)
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);
    return { data: result.data, error: result.error };
  }, { failOnTruncation: true });
  if (error) throw new Error('Inquiry backlog lookup failed', { cause: error });

  const evidence: Evidence = { messages: [], replies: [] };
  for (let index = 0; index < rows.length; index += EVIDENCE_CHUNK) {
    const chunk = await readMailReplyEvidence(db, rows.slice(index, index + EVIDENCE_CHUNK).map((row) => row.id));
    evidence.messages.push(...chunk.messages);
    evidence.replies.push(...chunk.replies);
  }

  const items = classifyInquiryBacklog(rows, evidence, now);
  const unreplied = items.filter((item) => item.reason === 'unreplied');
  const repliedOpen = items.filter((item) => item.reason === 'repliedOpen');
  if (items.length > 0) {
    const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-jp.com';
    alertWarning(`運営宛のお問い合わせに未完了が${items.length}件あります（未返信${unreplied.length}件・返信後${REPLIED_OPEN_DAYS}日以上未完了${repliedOpen.length}件）`, {
      category: '完了未確認',
      route: '/api/cron/cron-heartbeat',
      extra: {
        // 案内を先に置く（alert.ts は本文を 1500 文字で切るため、一覧が長くても案内は残る）
        adminUrl: `${base}/admin/inquiries`,
        howToClose: '問い合わせ管理で該当のタブを開き、状態を「解決済み」にすると次回から出ません',
        unreplied: unreplied.length ? unreplied.slice(0, LISTED_ITEMS).map(formatItem) : 'なし',
        repliedOpen: repliedOpen.length ? repliedOpen.slice(0, LISTED_ITEMS).map(formatItem) : 'なし',
        omitted: Math.max(0, unreplied.length - LISTED_ITEMS) + Math.max(0, repliedOpen.length - LISTED_ITEMS),
      },
    });
  }
  return { unreplied: unreplied.length, repliedOpen: repliedOpen.length };
}
