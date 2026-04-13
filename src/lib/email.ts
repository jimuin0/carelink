import { Resend } from 'resend';
import * as Sentry from '@sentry/nextjs';

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const FROM = process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>';
import { SITE_URL } from '@/lib/constants';

/** HTML特殊文字エスケープ（XSS防止） */
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function wrapHtml(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;line-height:1.6;max-width:600px;margin:0 auto;padding:20px;">
    <div style="text-align:center;margin-bottom:24px;"><strong style="color:#0ea5e9;font-size:20px;">CareLink</strong></div>
    ${body}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px;" />
    <p style="font-size:12px;color:#94a3b8;text-align:center;">このメールは <a href="${SITE_URL}" style="color:#0ea5e9;">CareLink</a> から自動送信されています。</p>
  </body></html>`;
}

// テスト用にpure関数をexport
export { esc, formatDate, formatTime };

/** メール送信ラッパー（エラーログ付き） */
async function safeSend(resend: Resend, params: Parameters<Resend['emails']['send']>[0], context: string) {
  try {
    await resend.emails.send(params);
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'email', email_type: context } });
  }
}

/** 予約受付確認（顧客向け） */
export async function sendBookingConfirmation(data: BookingEmailData) {
  const resend = getResend();
  if (!resend) return;
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  await safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: `【CareLink】${data.facilityName}のご予約を受け付けました`,
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}へのご予約を受け付けました。<br>施設からの確認後、確定メールをお送りいたします。</p>
      ${bookingDetailHtml(data)}
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/mypage" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">予約を確認する</a></p>
    `),
  }, 'booking_confirmation');
}

/** 予約リマインド通知（前日） */
export async function sendBookingReminder(data: BookingEmailData) {
  const resend = getResend();
  if (!resend) return;
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  await safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: `【CareLink】明日のご予約リマインド - ${data.facilityName}`,
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>明日、${facility}のご予約がございます。</p>
      ${bookingDetailHtml(data)}
      <p>お忘れなく、お時間に余裕を持ってご来店ください。</p>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/mypage" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">予約詳細を見る</a></p>
    `),
  }, 'booking_reminder');
}

/** 予約確定通知（顧客向け） */
export async function sendBookingConfirmed(data: BookingEmailData) {
  const resend = getResend();
  if (!resend) return;
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  await safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: `【CareLink】${data.facilityName}のご予約が確定しました`,
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
export async function sendBookingCancelled(data: BookingEmailData) {
  const resend = getResend();
  if (!resend) return;
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  await safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: `【CareLink】${data.facilityName}のご予約がキャンセルされました`,
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}のご予約がキャンセルされました。</p>
      ${bookingDetailHtml(data)}
      <p>またのご利用をお待ちしております。</p>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/search" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">他のサロンを探す</a></p>
    `),
  }, 'booking_cancelled');
}

/** 新規予約通知（施設向け） */
export async function sendNewBookingNotification(data: BookingEmailData & { facilityEmail: string }) {
  const resend = getResend();
  if (!resend) return;
  const name = esc(data.customerName);
  const email = esc(data.customerEmail);
  await safeSend(resend, {
    from: FROM,
    to: data.facilityEmail,
    subject: `【CareLink】新しい予約が入りました - ${data.customerName}様`,
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

/** 予約ステータス変更通知（顧客向け） */
export async function sendBookingStatusUpdate(data: BookingEmailData & { newStatus: string; reason?: string }) {
  const resend = getResend();
  if (!resend) return;

  const statusLabels: Record<string, string> = {
    confirmed: '確定',
    completed: '完了',
    cancelled: 'キャンセル',
    no_show: 'キャンセル（無断）',
  };
  const statusLabel = statusLabels[data.newStatus] || data.newStatus;
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);

  await safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    subject: `【CareLink】予約ステータスが「${statusLabel}」に変更されました`,
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}のご予約のステータスが<strong>「${statusLabel}」</strong>に変更されました。</p>
      ${data.reason ? `<p style="background:#fef3c7;padding:12px;border-radius:8px;font-size:14px;">理由: ${esc(data.reason)}</p>` : ''}
      ${bookingDetailHtml(data)}
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/mypage" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">予約を確認する</a></p>
    `),
  }, 'booking_status_update');
}
