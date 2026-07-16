import { Resend } from 'resend';
import { safeCaptureException } from '@/lib/safe';
import { postAlert } from '@/lib/alert';
import { bookingStatusLabel } from '@/lib/booking-status';
import { SITE_URL } from '@/lib/constants';
import { enqueueWebhook } from '@/lib/webhook-queue';
import crypto from 'crypto';

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const DEFAULT_FROM = 'CareLink <noreply@carelink-jp.com>';

// Resend が受理する from 形式は `email@example.com` または `Name <email@example.com>`。
// 「email@domain.tld」の実体（@ の前後があり、ドメインに . がある）を含むかで妥当性を判定する。
// 【2026年7月8日・本番診断で確定した恒久根治】本番 EMAIL_FROM が「carelink-jp.com」等の
// 不正形式（@ を含まない＝メールアドレスでない）に設定されており、Resend が 422 validation_error で
// 拒否 → safeSend が旧実装でエラーを握り潰し「送信成功」に化けていた。不正な env 値がコードの
// 有効なデフォルトを上書きして送信全滅を招くため、妥当性を検査し不正なら DEFAULT_FROM に倒す。
function isValidFrom(from: string): boolean {
  return /[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+/.test(from);
}

const RAW_FROM = process.env.EMAIL_FROM || DEFAULT_FROM;
const FROM = isValidFrom(RAW_FROM) ? RAW_FROM : DEFAULT_FROM;

// Resend で verified 済みのドメインのみ許可（未検証ドメインは送信元として使うと Resend 側で
// 拒否/制限される）。EMAIL_FROM の設定ミスは実際にメールが送られるまで気づけなかった
// （本番でこの穴により口コミ通知メールが未達になった 2026年7月6日 の事例を踏まえた予防策）。
const RESEND_VERIFIED_DOMAINS = ['carelink-jp.com'];

(function validateFromDomain() {
  // 開発・テストでは Resend のサンドボックスドメイン(resend.dev 等)を使うのが正常系のため、
  // 本番実行時のみ検証する。
  if (process.env.NODE_ENV !== 'production') return;
  // 不正形式で DEFAULT_FROM に倒れた場合も、その事実を可視化する（設定ミスの早期検知）。
  if (!isValidFrom(RAW_FROM)) {
    const msg = `EMAIL_FROM の形式が不正なため既定値にフォールバックしました。Resend の from 形式（Name <email@example.com>）で設定してください。`;
    console.error(`[email:from-format-guard]`, msg);
    postAlert({ level: 'error', message: msg, route: 'email:from-format-guard', env: process.env.VERCEL_ENV });
  }
  const match = FROM.match(/@([^>\s]+)/);
  const domain = match?.[1]?.toLowerCase();
  if (domain && !RESEND_VERIFIED_DOMAINS.includes(domain)) {
    const msg = `EMAIL_FROM のドメイン "${domain}" が Resend 検証済みドメイン(${RESEND_VERIFIED_DOMAINS.join(', ')})に含まれていません。メール送信が全て失敗する可能性があります。`;
    console.error(`[email:from-domain-guard]`, msg);
    postAlert({ level: 'error', message: msg, route: 'email:from-domain-guard', env: process.env.VERCEL_ENV });
  }
})();

/** HTML特殊文字エスケープ（XSS防止） */
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** メール件名用サニタイズ（ヘッダーインジェクション防止） */
function escSubject(str: string): string {
  return str.replace(/[\r\n\t]/g, ' ').slice(0, 200);
}

interface BookingEmailData {
  customerName: string;
  customerEmail: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  menuName?: string;
  staffName?: string;
  totalPrice?: number;
  bookingId: string;
  // キャンセル料（無料期限超過時のみ正の値・客への通知用。実徴収は店舗と客で直接）。
  cancelFee?: number;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${days[date.getUTCDay()]}）`;
}

function formatTime(time: string): string {
  return time.slice(0, 5);
}

function bookingDetailHtml(data: BookingEmailData): string {
  const td = 'padding:8px 12px;border:1px solid #e2e8f0;';
  const th = `${td}background:#f8fafc;font-weight:600;width:120px;`;
  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="${th}">日時</td><td style="${td}">${formatDate(data.bookingDate)} ${formatTime(data.startTime)}〜${formatTime(data.endTime)}</td></tr>
      ${data.menuName ? `<tr><td style="${th}">メニュー</td><td style="${td}">${esc(data.menuName)}</td></tr>` : ''}
      ${data.staffName ? `<tr><td style="${th}">担当</td><td style="${td}">${esc(data.staffName)}</td></tr>` : ''}
      ${data.totalPrice != null ? `<tr><td style="${th}">料金</td><td style="${td}">&yen;${data.totalPrice.toLocaleString()}</td></tr>` : ''}
    </table>
  `;
}

/** 配信停止トークン生成（32バイト hex） */
export function generateUnsubscribeToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function wrapHtml(body: string, unsubscribeToken?: string): string {
  const unsubLink = unsubscribeToken
    ? `<p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:8px;"><a href="${SITE_URL}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}" style="color:#94a3b8;">メールの受信を停止する</a></p>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;line-height:1.6;max-width:600px;margin:0 auto;padding:20px;">
    <div style="text-align:center;margin-bottom:24px;"><strong style="color:#0ea5e9;font-size:20px;">CareLink</strong></div>
    ${body}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px;" />
    <p style="font-size:12px;color:#94a3b8;text-align:center;">このメールは <a href="${SITE_URL}" style="color:#0ea5e9;">CareLink</a> から自動送信されています。</p>
    ${unsubLink}
  </body></html>`;
}

// テスト用にpure関数をexport
export { esc, escSubject, formatDate, formatTime };

/**
 * cron が run 単位で alertDeliveryFailures() に集約して1メッセージにまとめて通知する context。
 * これらは safeSend からも個別に postAlert すると、集約1件 + 失敗件数分の個別アラートが
 * 二重に飛び、正当な個別失敗（顧客のメールアドレス不備等）で Slack が連投される
 * （alertDeliveryFailures のコメントが名指しで禁止しているアンチパターンの再導入になる）。
 * 該当 cron: booking-reminder / daily-summary / weekly-report / onboarding-followup / favorites-digest
 */
const BULK_AGGREGATED_CONTEXTS = new Set([
  'booking_reminder',
  'daily_summary',
  'weekly_report',
  'onboarding_follow',
  'favorites_digest',
]);

/**
 * webhook_retry_queue（15分毎の webhook-retry cron）へ自動再送登録する対象 context。
 *
 * 対象＝顧客向け・単発（HTTPリクエスト起点の1回送信）で、他に再送手段が存在しない通知のみ。
 * 上の BULK_AGGREGATED_CONTEXTS（booking_reminder / daily_summary / weekly_report /
 * onboarding_follow / favorites_digest）は各 cron が claim テーブルで「送達失敗時は claim を
 * 解放し翌 run で再送する」独自の再送機構を既に持つため、ここに二重で積むと
 * webhook-retry cron（15分毎）と cron 自身の翌 run 再送が競合し二重配信になり得るため対象外。
 * 施設オーナー向け（new_review_notification / new_inquiry_notification /
 * new_booking_notification / booking_cancellation_facility / welcome）も対象外
 * （今回のスコープ＝顧客向け通知のみ・2026年7月16日 神原さん承認）。
 */
const QUEUEABLE_EMAIL_CONTEXTS = new Set([
  'booking_confirmation',
  'booking_rescheduled',
  'time_adjust_request',
  'booking_confirmed',
  'booking_cancelled',
  'booking_status_update',
]);

/**
 * Resend send params から webhook_retry_queue の email payload（{to,subject,html,from}）へ変換する。
 * QUEUEABLE_EMAIL_CONTEXTS の呼び出し元は本ファイル内の send* 関数のみで、いずれも
 * `{ from, to, subject, html }` を単純な string リテラルで組み立てている（配列 to や省略は無い）ため、
 * 防御的な型チェックは行わず素直にキャストする（=到達不能な分岐を作らずカバレッジを健全に保つ）。
 */
function toQueuePayload(
  params: Parameters<Resend['emails']['send']>[0]
): { to: string; subject: string; html: string; from?: string } {
  const p = params as { to: string; subject: string; html: string; from?: string };
  return { to: p.to, subject: p.subject, html: p.html, from: p.from };
}

/**
 * メール送信ラッパー（エラーログ付き）。
 * 戻り値: 送信成功=true / 例外を握り潰した場合=false。
 * 「失敗時は翌 run で再送」する cron（onboarding-followup / favorites-digest）は、この戻り値で
 * 実際の送達可否を判定する。再throwすると他の一括送信が巻き込まれて止まるため throw はしない。
 */
async function safeSend(resend: Resend, params: Parameters<Resend['emails']['send']>[0], context: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fail = (detail: string): false => {
    safeCaptureException(new Error(`resend send failed: ${detail}`), `email:${context}`);
    if (!BULK_AGGREGATED_CONTEXTS.has(context)) {
      postAlert({ level: 'error', message: `メール送信失敗(${context}): ${detail}`, route: `email:${context}`, env: process.env.VERCEL_ENV });
    }
    // 送信失敗を webhook_retry_queue に積み、15分毎の webhook-retry cron に自動再送させる
    // （対象 context のみ・enqueueWebhook 自体は DB 失敗を握り潰す fire-and-forget 契約のため
    // ここでの失敗が safeSend の false 契約や呼び出し元の挙動へ波及することはない）。
    if (QUEUEABLE_EMAIL_CONTEXTS.has(context)) {
      const queuePayload = toQueuePayload(params);
      void enqueueWebhook({ type: 'email', targetId: queuePayload.to, payload: queuePayload });
    }
    return false;
  };
  try {
    // 監査X7: Resend SDK は自前タイムアウトを持たず、cron の maxDuration/予算ガードは
    // iteration 間でしか効かないため await 中のハングを救えない。Promise.race で 10s 上限を
    // 課し、ハング時は失敗(false)扱いにして一括送信全体のブロックを防ぐ。
    const result = await Promise.race([
      resend.emails.send(params),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('resend send timeout (10s)')), 10_000);
      }),
    ]);
    // 【最重要・2026年7月8日 本番診断で確定した恒久根治】Resend SDK は API エラー（Invalid from の
    // 422 等）を throw せず戻り値 { data, error } の error に載せて resolve する。旧実装は error を
    // 検査せず無条件 return true していたため、送信失敗が「成功」に化け、ローンチ以来 通知メールが
    // 送られていないのに全て成功扱いされ、アラートも一切出なかった。error を必ず検査する。
    if (result && result.error) {
      const err = result.error as { statusCode?: number; name?: string; message?: string };
      return fail(`${err.statusCode ?? ''} ${err.name ?? ''} ${err.message ?? JSON.stringify(result.error)}`.trim());
    }
    return true;
  } catch (e) {
    // タイムアウト・ネットワーク断等の例外系。
    return fail(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}


/** 予約受付確認（顧客向け） */
export async function sendBookingConfirmation(data: BookingEmailData): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  return safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】${data.facilityName}のご予約を受け付けました`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}へのご予約を受け付けました。<br>施設からの確認後、確定メールをお送りいたします。</p>
      ${bookingDetailHtml(data)}
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/mypage" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">予約を確認する</a></p>
    `),
  }, 'booking_confirmation');
}

/** 予約日時の変更確認（顧客向け・A-4）。作成/キャンセルと対称に、変更後の新しい日時を顧客へ通知する。 */
export async function sendBookingRescheduled(data: BookingEmailData): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  return safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】${data.facilityName}のご予約日時を変更しました`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}のご予約日時を下記のとおり変更しました。</p>
      ${bookingDetailHtml(data)}
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/mypage" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">予約を確認する</a></p>
    `),
  }, 'booking_rescheduled');
}

/**
 * 予約リマインド通知（前日/3日前/7日前）
 * daysBefore: 1=明日（既定・従来挙動）/ 3=3日後 / 7=7日後 の文言で送る。
 */
export async function sendBookingReminder(data: BookingEmailData, daysBefore: number = 1): Promise<boolean> {
  const resend = getResend();
  // API キー未設定は送達不可＝false（cron 側で未送信扱い＝claim 解放して翌 run で再送）。
  // 従来は undefined を返しており、cron 側が戻り値を見ず sent++ していたため、送信失敗が
  // 無音化し claim 保持で恒久 miss になっていた（LINE 側は ok 判定済み＝非対称の穴）。
  if (!resend) return false;
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  const when = daysBefore === 1 ? '明日' : `${daysBefore}日後`;
  return safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】${when}のご予約リマインド - ${data.facilityName}`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${when}、${facility}のご予約がございます。</p>
      ${bookingDetailHtml(data)}
      <p>お忘れなく、お時間に余裕を持ってご来店ください。</p>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/mypage" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">予約詳細を見る</a></p>
    `),
  }, 'booking_reminder');
}

/**
 * 予約時間調整のお願い（施設→顧客）
 * SB の予約詳細から送信する。メール送信は無料（LINE 送信は有料オプション）。
 */
export async function sendTimeAdjustRequest(data: BookingEmailData): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  return safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】ご予約時間調整のお願い - ${data.facilityName}`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}より、ご予約のお時間について調整のお願いがございます。</p>
      ${bookingDetailHtml(data)}
      <p>恐れ入りますが、マイページの予約変更または施設へのご連絡にて、ご都合の良いお時間をお知らせください。</p>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/mypage" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">予約を変更する</a></p>
    `),
  }, 'time_adjust_request');
}

/** 予約確定通知（顧客向け） */
export async function sendBookingConfirmed(data: BookingEmailData): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  return safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】${data.facilityName}のご予約が確定しました`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}のご予約が<strong style="color:#16a34a;">確定</strong>しました。</p>
      ${bookingDetailHtml(data)}
      <p>当日のご来店をお待ちしております。</p>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/mypage" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">予約詳細を見る</a></p>
    `),
  }, 'booking_confirmed');
}

/** 予約キャンセル通知（顧客向け） */
export async function sendBookingCancelled(data: BookingEmailData): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  return safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】${data.facilityName}のご予約がキャンセルされました`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}のご予約がキャンセルされました。</p>
      ${bookingDetailHtml(data)}
      ${data.cancelFee && data.cancelFee > 0 ? `<div style="margin:16px 0;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:14px;">キャンセルポリシーにより、キャンセル料として <strong>¥${data.cancelFee.toLocaleString()}</strong> が発生します。お支払い方法は施設より直接ご案内いたします。</div>` : ''}
      <p>またのご利用をお待ちしております。</p>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/search" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">他のサロンを探す</a></p>
    `),
  }, 'booking_cancelled');
}

/** 新着口コミ通知（施設向け・push_on_review設定と共通制御） */
export async function sendNewReviewNotification(data: {
  facilityEmail: string;
  facilityName: string;
  reviewerName: string;
  rating: number;
  comment?: string | null;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const name = esc(data.reviewerName);
  const comment = data.comment ? esc(data.comment) : null;
  return safeSend(resend, {
    from: FROM,
    to: data.facilityEmail,
    subject: escSubject(`【CareLink】新しい口コミが投稿されました - ★${data.rating}`),
    html: wrapHtml(`
      <p>新しい口コミが投稿されました。管理画面から確認・返信してください。</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:120px;">投稿者</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${name}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">評価</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">★${data.rating}</td></tr>
        ${comment ? `<tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">コメント</td><td style="padding:8px 12px;border:1px solid #e2e8f0;white-space:pre-wrap;">${comment}</td></tr>` : ''}
      </table>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin/reviews" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">管理画面で確認する</a></p>
    `),
  }, 'new_review_notification');
}

/**
 * 新規問い合わせ通知（施設向け）。
 * 【2026年7月10日 恒久根治】施設ページの問い合わせフォーム(InquiryForm.tsx)は
 * facility_inquiries へ保存されるが、従来オーナー宛メール通知が存在せず、参照できる管理画面
 * (admin/facility-inquiries)も存在しなかった（問い合わせが実質誰にも届かない構造的欠陥）。
 * Slack通知(type=facility_inquiry)は既に存在するが、施設オーナーが必ずSlackを見ているとは
 * 限らないため、確実に届く経路としてメール通知を新設する。
 */
export async function sendNewInquiryNotification(data: {
  facilityEmail: string;
  facilityName: string;
  inquirerName: string;
  inquirerEmail: string;
  inquirerPhone?: string | null;
  message: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const name = esc(data.inquirerName);
  const email = esc(data.inquirerEmail);
  const phone = data.inquirerPhone ? esc(data.inquirerPhone) : null;
  const message = esc(data.message);
  return safeSend(resend, {
    from: FROM,
    to: data.facilityEmail,
    subject: escSubject(`【CareLink】新しいお問い合わせが届きました - ${data.inquirerName}様`),
    html: wrapHtml(`
      <p>${esc(data.facilityName)}宛に新しいお問い合わせが届きました。管理画面から確認・返信してください。</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:120px;">お名前</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${name}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">メール</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${email}</td></tr>
        ${phone ? `<tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">電話</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${phone}</td></tr>` : ''}
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">お問い合わせ内容</td><td style="padding:8px 12px;border:1px solid #e2e8f0;white-space:pre-wrap;">${message}</td></tr>
      </table>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin/facility-inquiries" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">管理画面で確認する</a></p>
    `),
  }, 'new_inquiry_notification');
}

/** 新規予約通知（施設向け） */
export async function sendNewBookingNotification(data: BookingEmailData & { facilityEmail: string }): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const name = esc(data.customerName);
  const email = esc(data.customerEmail);
  return safeSend(resend, {
    from: FROM,
    to: data.facilityEmail,
    subject: escSubject(`【CareLink】新しい予約が入りました - ${data.customerName}様`),
    html: wrapHtml(`
      <p>新しい予約が入りました。管理画面から確認・承認してください。</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:120px;">お客様名</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${name}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">メール</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${email}</td></tr>
      </table>
      ${bookingDetailHtml(data)}
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin/bookings" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">管理画面で確認する</a></p>
    `),
  }, 'new_booking_notification');
}

/** 予約キャンセル通知（施設向け） */
export async function sendBookingCancellationToFacility(data: BookingEmailData & { facilityEmail: string }): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const name = esc(data.customerName);
  const email = esc(data.customerEmail);
  return safeSend(resend, {
    from: FROM,
    to: data.facilityEmail,
    subject: escSubject(`【CareLink】予約がキャンセルされました - ${data.customerName}様`),
    html: wrapHtml(`
      <p>下記のご予約がキャンセルされました。管理画面で予約状況をご確認ください。</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:120px;">お客様名</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${name}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">メール</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${email}</td></tr>
      </table>
      ${bookingDetailHtml(data)}
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin/bookings" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">管理画面で確認する</a></p>
    `),
  }, 'booking_cancellation_facility');
}

/** 日次売上サマリー（施設オーナー向け・email_daily_summary 有効時のみ daily-summary cron から送信） */
export async function sendDailySummaryEmail(data: {
  facilityEmail: string;
  facilityName: string;
  date: string;
  totalRevenue: number;
  bookingCount: number;
  completedCount: number;
  cancelledCount: number;
  newCustomerCount: number;
  repeatCustomerCount: number;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const facility = esc(data.facilityName);
  const date = esc(data.date);
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px;color:#475569;">${label}</td><td style="padding:6px 12px;text-align:right;font-weight:600;">${value}</td></tr>`;
  return safeSend(resend, {
    from: FROM,
    to: data.facilityEmail,
    subject: escSubject(`【CareLink】${data.date} の売上サマリー（${data.facilityName}）`),
    html: wrapHtml(`
      <p>${facility} 様</p>
      <p>${date} の売上サマリーをお届けします。</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        ${row('売上', `¥${data.totalRevenue.toLocaleString()}`)}
        ${row('予約数', `${data.bookingCount}件`)}
        ${row('完了', `${data.completedCount}件`)}
        ${row('キャンセル', `${data.cancelledCount}件`)}
        ${row('新規顧客', `${data.newCustomerCount}名`)}
        ${row('リピート顧客', `${data.repeatCustomerCount}名`)}
      </table>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin/analytics" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">分析を見る</a></p>
    `),
  }, 'daily_summary');
}

/** 週次レポート（施設オーナー向け・email_weekly_report 有効時のみ weekly-report cron から送信） */
export async function sendWeeklyReportEmail(data: {
  facilityEmail: string;
  facilityName: string;
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  bookingCount: number;
  completedCount: number;
  cancelledCount: number;
  newCustomerCount: number;
  repeatCustomerCount: number;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const facility = esc(data.facilityName);
  const period = esc(`${data.periodStart} 〜 ${data.periodEnd}`);
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px;color:#475569;">${label}</td><td style="padding:6px 12px;text-align:right;font-weight:600;">${value}</td></tr>`;
  return safeSend(resend, {
    from: FROM,
    to: data.facilityEmail,
    subject: escSubject(`【CareLink】週次レポート（${data.facilityName}）`),
    html: wrapHtml(`
      <p>${facility} 様</p>
      <p>${period} の週次レポートをお届けします。</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        ${row('売上', `¥${data.totalRevenue.toLocaleString()}`)}
        ${row('予約数', `${data.bookingCount}件`)}
        ${row('完了', `${data.completedCount}件`)}
        ${row('キャンセル', `${data.cancelledCount}件`)}
        ${row('新規顧客', `${data.newCustomerCount}名`)}
        ${row('リピート顧客', `${data.repeatCustomerCount}名`)}
      </table>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin/analytics" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">分析を見る</a></p>
    `),
  }, 'weekly_report');
}

/** 施設オーナー向けウェルカムメール（登録直後） */
export async function sendWelcomeEmail(data: { ownerEmail: string; ownerName?: string; facilityName: string }): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const name = esc(data.ownerName || 'オーナー');
  const facility = esc(data.facilityName);
  return safeSend(resend, {
    from: FROM,
    to: data.ownerEmail,
    subject: escSubject(`【CareLink】${data.facilityName}の登録ありがとうございます`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>この度はCareLinksに施設を登録いただき、ありがとうございます！</p>
      <p>以下の3ステップを完了すると、お客様があなたの施設を見つけやすくなります。</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr><td style="padding:12px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;width:40px;text-align:center;">1</td><td style="padding:12px;border:1px solid #e2e8f0;">メニュー・料金を登録する</td></tr>
        <tr><td style="padding:12px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;text-align:center;">2</td><td style="padding:12px;border:1px solid #e2e8f0;">スタッフを登録してスケジュールを設定する</td></tr>
        <tr><td style="padding:12px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;text-align:center;">3</td><td style="padding:12px;border:1px solid #e2e8f0;">施設写真をアップロードして「公開」にする</td></tr>
      </table>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">${facility}の管理画面へ</a></p>
    `),
  }, 'welcome');
}

/** 施設オーナー向け3日後フォローメール（未完了項目のリマインド） */
export async function sendOnboardingFollowEmail(data: {
  ownerEmail: string;
  facilityName: string;
  missingSteps: string[];
}) {
  const resend = getResend();
  // API キー未設定は送達不可＝false（cron 側で未送信扱い）。
  if (!resend) return false;
  const facility = esc(data.facilityName);
  const missing = data.missingSteps.map(s => `<li>${esc(s)}</li>`).join('');
  return safeSend(resend, {
    from: FROM,
    to: data.ownerEmail,
    subject: escSubject(`【CareLink】${data.facilityName}の設定があと少しです`),
    html: wrapHtml(`
      <p>${facility}のご登録から数日が経ちました。</p>
      <p>以下の項目が未設定です。設定を完了するとお客様が予約しやすくなります！</p>
      <ul style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:16px 16px 16px 32px;margin:16px 0;">${missing}</ul>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">管理画面で設定を完了する</a></p>
    `),
  }, 'onboarding_follow');
}

export async function sendBookingStatusUpdate(data: BookingEmailData & { newStatus: string; reason?: string }): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  const statusLabel = bookingStatusLabel(data.newStatus);
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);

  return safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】予約ステータスが「${statusLabel}」に変更されました`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}のご予約のステータスが<strong>「${statusLabel}」</strong>に変更されました。</p>
      ${data.reason ? `<p style="background:#fef3c7;padding:12px;border-radius:8px;font-size:14px;">理由: ${esc(data.reason)}</p>` : ''}
      ${bookingDetailHtml(data)}
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/mypage" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">予約を確認する</a></p>
    `),
  }, 'booking_status_update');
}

/** お気に入り施設ダイジェスト通知 */
export async function sendFavoritesDigest(data: {
  userEmail: string;
  userName?: string;
  facilities: { name: string; slug: string; newCoupons: number; hasNewMenus: boolean }[];
  unsubscribeToken?: string;
}) {
  const resend = getResend();
  // API キー未設定は送達不可＝false（cron 側で未送信扱い）。
  if (!resend) return false;

  const name = esc(data.userName || 'お客様');
  const facilityRows = data.facilities.map((f) => {
    const updates: string[] = [];
    if (f.newCoupons > 0) updates.push(`新着クーポン ${f.newCoupons}件`);
    if (f.hasNewMenus) updates.push('新メニュー追加');
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
          <a href="${SITE_URL}/facility/${encodeURIComponent(f.slug)}" style="color:#0ea5e9;font-weight:600;text-decoration:none;">${esc(f.name)}</a>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;">${updates.join('、')}</td>
      </tr>
    `;
  }).join('');

  return safeSend(resend, {
    from: FROM,
    to: data.userEmail,
    subject: escSubject(`【CareLink】お気に入り施設の新着情報があります`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>お気に入り施設に新着情報があります。</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px 12px;border-bottom:2px solid #e2e8f0;text-align:left;font-size:13px;">施設名</th>
            <th style="padding:8px 12px;border-bottom:2px solid #e2e8f0;text-align:left;font-size:13px;">新着情報</th>
          </tr>
        </thead>
        <tbody>${facilityRows}</tbody>
      </table>
      <p style="text-align:center;margin-top:24px;">
        <a href="${SITE_URL}/mypage/favorites" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">
          お気に入りを見る
        </a>
      </p>
    `, data.unsubscribeToken),
  }, 'favorites_digest');
}
