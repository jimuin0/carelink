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
 * 🔴 Slack はプライバシーポリシーの委託先に無いため、名前・メール・本文は載せない
 * （受付番号の先頭8文字と経過日数と件数だけ。中身は /admin/mail で見る・src/lib/notify.ts と同じ方針）。
 */
import type { createServiceRoleClient } from './supabase-server';
import { alertWarning } from './alert';
import { fetchAllPaged } from './paginate';
import { readMailReplyEvidence } from './platform-mail-read';
import { summarizeMailReplies, type LegacyMailReply } from './platform-mail-contract';

type DB = ReturnType<typeof createServiceRoleClient>;
type Evidence = Awaited<ReturnType<typeof readMailReplyEvidence>>;

export const UNREPLIED_DAYS = 1;
export const REPLIED_OPEN_DAYS = 7;
const OPEN_STATUSES = ['open', 'in_progress', 'waiting'] as const;
const EVIDENCE_CHUNK = 100;
const LISTED_ITEMS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BacklogContact { id: string; created_at: string | null }
export interface BacklogItem { id: string; ageDays: number; reason: 'unreplied' | 'repliedOpen' }

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
    if (!summary.replied && ageDays >= UNREPLIED_DAYS) items.push({ id: contact.id, ageDays, reason: 'unreplied' });
    else if (summary.replied && ageDays >= REPLIED_OPEN_DAYS) items.push({ id: contact.id, ageDays, reason: 'repliedOpen' });
  }
  return items.sort((a, b) => b.ageDays - a.ageDays);
}

function formatItem(item: BacklogItem): string {
  const days = item.ageDays === Number.MAX_SAFE_INTEGER ? '日時不明' : `${item.ageDays}日`;
  return `${item.id.slice(0, 8)}（${days}）`;
}

/**
 * 未完了の問い合わせを数え、知らせるものがあれば Slack に 1 通出す。
 * 取得に失敗したら throw する（「0件」と区別できないまま黙らないため。呼び出し側の cron で記録する）。
 */
export async function reportInquiryBacklog(db: DB, now: Date = new Date()): Promise<{ unreplied: number; repliedOpen: number }> {
  const { rows, error } = await fetchAllPaged<BacklogContact>(async (offset, limit) => {
    const result = await db.from('contacts').select('id,created_at')
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
      route: '/api/cron/daily-summary',
      extra: {
        unreplied: unreplied.slice(0, LISTED_ITEMS).map(formatItem).join('、') || 'なし',
        repliedOpen: repliedOpen.slice(0, LISTED_ITEMS).map(formatItem).join('、') || 'なし',
        omitted: Math.max(0, items.length - LISTED_ITEMS * 2),
        adminUrl: `${base}/admin/mail`,
      },
    });
  }
  return { unreplied: unreplied.length, repliedOpen: repliedOpen.length };
}
