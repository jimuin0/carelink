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
import { alertWarning, redactAlertText } from './alert';
import { fetchAllPaged } from './paginate';
import { readMailReplyEvidence } from './platform-mail-read';
import { summarizeMailReplies, type LegacyMailReply } from './platform-mail-contract';
import { postInquiryResolveButtons, MAX_TOTAL_BUTTON_ITEMS } from './inquiry-slack-actions';
import { runAfterResponse } from './after-response';

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

/**
 * 今日（日本時間）の通知の権利を 1 回だけ取る。取れたら true。
 * 既存のレート制限 RPC（check_rate_limit・DB の中で原子的に数える）を「日付ごとに 1 回」で使うので、
 * 9 時台に 2 回動いても、同時に 2 本動いても、通知は 1 通だけになる（Codex 指摘 PR993-05）。
 * RPC が失敗したときは true（＝通知する）。重複は困るが、黙って出さないほうがもっと困るため。
 */
export async function claimInquiryBacklogReport(db: DB, now: Date): Promise<boolean> {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = jst.toISOString().slice(0, 10);
  try {
    const { data, error } = await db.rpc('check_rate_limit', { p_key: `inquiry-backlog-report:${day}`, p_limit: 1, p_window_ms: 26 * 60 * 60 * 1000 });
    if (error || typeof data !== 'boolean') return true;
    // 🔴 check_rate_limit の戻り値は TRUE＝制限中（上限超え）・FALSE＝許可（20260526000001 の定義）。
    // 「取れたか」は逆なので反転する（一度ここを逆に読み、初回が出ず 2 回目以降が出る実装になった・Codex 指摘 PR993-05）。
    return !data;
  } catch {
    return true;
  }
}

export const UNREPLIED_DAYS = 1;
export const REPLIED_OPEN_DAYS = 7;
const OPEN_STATUSES = ['open', 'in_progress', 'waiting'] as const;
const EVIDENCE_CHUNK = 100;
const LISTED_ITEMS = 10;
/**
 * 一覧に使ってよい文字数（UTF-16 単位）。alert.ts は補足欄の JSON を 1500 文字で切るため、
 * 案内・キー・字下げ・省略件数のぶんを残し、一覧の行はこの範囲に収まるだけ載せる。
 * 件数だけで切ると、名前が長いときに Slack 側で行の途中から切れ、省略件数も消える（Codex 指摘 PR993-04）。
 */
const LIST_CHAR_BUDGET = 500; // 区分ごと（未返信・返信後未完了）。1行は最大でも約90文字なので、区分に1件以上あれば必ず1行は載る
const LINE_OVERHEAD = 8; // 字下げ・引用符・カンマ・改行
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
  const label = `${chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX).join('')}…` : normalized}様`;
  // alert.ts の伏せ字処理（token= 等）にかかる名前は、行ごと伏せ字にされて受付日なども消えるため載せない。
  // 切り詰めて「様」を付けた後の形で判定する（切る前は通っても、切った後にかかることがある・Codex 指摘 PR993-06）
  if (redactAlertText(normalized) !== normalized || redactAlertText(label) !== label) return 'お名前は管理画面で確認';
  return label;
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
export async function reportInquiryBacklog(
  db: DB,
  now: Date = new Date(),
  // 送る直前に呼ぶ「今日の通知の枠」。読み取りが済んで送るものがあるときだけ取るので、
  // 読み取りに失敗しても枠は残り、同じ日に再実行すれば通知できる（Codex 指摘 PR993-08）。
  opts: { claim?: () => Promise<boolean> } = {},
): Promise<{ unreplied: number; repliedOpen: number } | 'already'> {
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
    if (opts.claim && !(await opts.claim())) return 'already';
    const take = (list: BacklogItem[]): string[] => {
      let budget = LIST_CHAR_BUDGET;
      const lines: string[] = [];
      for (const item of list.slice(0, LISTED_ITEMS)) {
        // alert.ts が送る前にかける伏せ字処理を先に通し、送る内容そのものの長さで数える（Codex 指摘 PR993-04）
        const line = redactAlertText(formatItem(item));
        const cost = JSON.stringify(line).length + LINE_OVERHEAD;
        if (cost > budget) break;
        budget -= cost;
        lines.push(line);
      }
      return lines;
    };
    const shownUnreplied = take(unreplied);
    const shownRepliedOpen = take(repliedOpen);
    const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-jp.com';
    alertWarning(`運営宛のお問い合わせに未完了が${items.length}件あります（未返信${unreplied.length}件・返信後${REPLIED_OPEN_DAYS}日以上未完了${repliedOpen.length}件）`, {
      category: '完了未確認',
      // 死活監視の警告（route=/api/cron/cron-heartbeat）と同じ Slack スレッドに混ざらないよう、route を分ける
      // （alert.ts はスレッドを level・route・commit でまとめる・Codex 指摘 PR993-07）
      route: '/api/cron/cron-heartbeat/inquiry-backlog',
      extra: {
        // 案内を先に置く（alert.ts は本文を 1500 文字で切るため、一覧が長くても案内は残る）
        adminUrl: `${base}/admin/inquiries`,
        howToClose: '問い合わせ管理で該当のタブを開き、状態を「解決済み」にすると次回から出ません',
        unreplied: shownUnreplied.length ? shownUnreplied : 'なし',
        repliedOpen: shownRepliedOpen.length ? shownRepliedOpen : 'なし',
        omitted: items.length - shownUnreplied.length - shownRepliedOpen.length,
        // ボタンは古い順に上限件数まで（送信時間を抑えるため）。超えた分は管理画面で閉じる（Codex 指摘 PR996-06）
        ...(items.length > MAX_TOTAL_BUTTON_ITEMS ? { buttons: `ボタンは古い順に${MAX_TOTAL_BUTTON_ITEMS}件まで。ほか${items.length - MAX_TOTAL_BUTTON_ITEMS}件は問い合わせ管理で閉じてください` } : {}),
      },
    });
    // 1件ごとに「解決済みにする」ボタンを付けたメッセージを続けて出す（2026年11月27日 神原さん指示）。
    // 解決済みにするまで毎朝出し続ける（自動では閉じない）。
    // 死活監視の cron の結果記録・応答を待たせないよう、応答後に送る（Codex 指摘 PR996-05）。
    const buttonLines = items.slice(0, MAX_TOTAL_BUTTON_ITEMS).map((item) => ({ id: item.id, label: redactAlertText(formatItem(item)) }));
    runAfterResponse(() => postInquiryResolveButtons(buttonLines, `${base}/admin/inquiries`));
  }
  return { unreplied: unreplied.length, repliedOpen: repliedOpen.length };
}
