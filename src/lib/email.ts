import { Resend } from 'resend';
import { sendResendForReconciliation } from './resend-result';
import { safeCaptureException } from '@/lib/safe';
import { postAlert } from '@/lib/alert';
import { bookingStatusLabel, canCustomerCancelBooking } from '@/lib/booking-status';
import { SITE_URL } from '@/lib/constants';
import { sendDurableEventEmail } from './event-email-delivery';
import { resolvedFromEnv, DEFAULT_FROM, RESEND_VERIFIED_DOMAINS } from '@/lib/email-from';
import { salonRecoveryAuthPath } from '@/lib/salon-browser-context';
import { REGISTRATION_TERMS as T } from './registration-glossary';
import crypto from 'crypto';
import { sendInquiryReplyEnvelope, verifyInquiryReplyAcceptance, type InquiryReplyEnvelope } from './inquiry-reply-delivery';
import { REMINDER_EMAIL_TIMING_NOTE } from './reminder-schedule';
import { adminFacilityHref } from './admin-facility-url';
import { formatJstDateTime, isCustomerEmailRecipient } from './cancel-fee-receipt';
import { isDialablePhone } from './facility-contact';

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// 送信元の解決規則は email-from.ts が SSOT（/api/health の設定監視と必ず同じ規則を使う）。
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const RESOLVED_FROM = resolvedFromEnv();
const FROM = RESOLVED_FROM.from;
const { rawDomain: RAW_DOMAIN, formatOk: FROM_FORMAT_OK, domainOk: FROM_DOMAIN_OK } = RESOLVED_FROM;

(function validateFromDomain() {
  // 開発・テストでは Resend のサンドボックスドメイン(resend.dev 等)を使うのが正常系のため、
  // 本番実行時のみ検証する。
  if (!IS_PRODUCTION) return;
  // 不正形式で DEFAULT_FROM に倒れた場合も、その事実を可視化する（設定ミスの早期検知）。
  if (!FROM_FORMAT_OK) {
    const msg = `EMAIL_FROM の形式が不正なため既定値にフォールバックしました。Resend の from 形式（Name <email@example.com>）で設定してください。`;
    console.error(`[email:from-format-guard]`, msg);
    postAlert({ level: 'error', message: msg, route: 'email:from-format-guard', env: process.env.VERCEL_ENV });
  } else if (!FROM_DOMAIN_OK) {
    // 倒した事実まで書く。「警告は出ていたが送信は死んでいた」を繰り返さないため。
    const msg = `EMAIL_FROM のドメイン "${RAW_DOMAIN}" が Resend 検証済みドメイン(${RESEND_VERIFIED_DOMAINS.join(', ')})に含まれていません。送信全滅を避けるため既定値 "${DEFAULT_FROM}" で送信します。EMAIL_FROM を検証済みドメインのアドレスに直してください。`;
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

export interface BookingEmailData {
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
  bookingStatus?: string;
  /** 店舗向けの新規予約通知だけが使う（お客様向けメールには載せない）。 */
  customerPhone?: string | null;
  /** お客様の備考。訪問専門の店舗では訪問先の住所を兼ねる（PR #755）。店舗向けの新規予約通知だけが使う。 */
  note?: string | null;
  /**
   * 予約時にお客様が使った CareLink ポイント（1pt＝1円）。totalPrice はポイント利用後の金額。
   * 店舗向けの新規予約通知だけが渡す（2026年10月23日）。0 や未指定なら行を出さない。
   */
  pointsUsed?: number;
  // キャンセル料（無料期限超過時のみ正の値・客への通知用。実徴収は店舗と客で直接）。
  cancelFee?: number;
  /** キャンセル料の料率（施術料金の%）。店舗向けのキャンセル通知だけが使う。 */
  cancelFeeRate?: number;
  /** お客様のキャンセルを受け付けた時刻（ISO）。店舗が無料期限の内か外かを確かめられるように載せる。 */
  cancelledAt?: string;
  /**
   * 会員として予約したか（bookings.user_id の有無）。お客様向けメールの「予約の確かめ方」を出し分ける。
   * - true: 会員の予約。マイページで確認・変更できる。
   * - false: ログインせずに予約した（ゲスト予約）。マイページには出ない（マイページは user_id で絞る）ので、
   *   マイページへは案内せず、店舗の連絡先を出す。
   * - 未指定: 分からない（この項目を持たない古い送信待ちのデータ等）。どちらのお客様にも通じる文面にする。
   */
  hasAccount?: boolean;
  /** 店舗の電話番号（isDialablePhone を通ったものだけ）。マイページを使えないお客様への連絡先として出す。 */
  facilityPhone?: string | null;
  /** 公開中の店舗の slug（非公開の店舗ページは 404 になるので渡さない）。 */
  facilitySlug?: string | null;
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
  const pointsUsed = data.pointsUsed ?? 0;
  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="${th}">日時</td><td style="${td}">${formatDate(data.bookingDate)} ${formatTime(data.startTime)}〜${formatTime(data.endTime)}</td></tr>
      ${data.menuName ? `<tr><td style="${th}">メニュー</td><td style="${td}">${esc(data.menuName)}</td></tr>` : ''}
      ${data.staffName ? `<tr><td style="${th}">担当</td><td style="${td}">${esc(data.staffName)}</td></tr>` : ''}
      ${data.totalPrice != null ? `<tr><td style="${th}">料金</td><td style="${td}">&yen;${data.totalPrice.toLocaleString()}${pointsUsed > 0 ? '（ポイント利用後）' : ''}</td></tr>` : ''}
      ${pointsUsed > 0 ? `<tr><td style="${th}">ポイント利用</td><td style="${td}">-&yen;${pointsUsed.toLocaleString()}</td></tr>` : ''}
    </table>
  `;
}

/** 配信停止トークン生成（32バイト hex） */
export function generateUnsubscribeToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * メール内ボタン（「管理画面で確認する」「予約を確認する」等）の共通スタイル。
 * 背景はサイトの primary（#0369A1）。白文字とのコントラストは約 5.9:1 で WCAG AA（4.5:1）を満たす。
 * 以前の #0ea5e9 は約 2.8:1 で、太字でも本文サイズのため AA に届かなかった。
 */
export const EMAIL_BUTTON_STYLE = 'display:inline-block;background:#0369A1;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;';

/**
 * 店舗への連絡手段（電話番号・店舗ページ）。マイページで予約を見られないお客様に出す。
 * 電話番号は店舗ページと同じ判定（isDialablePhone）を通ったときだけ載せる（tel: に任意の文字列を入れない）。
 */
function shopContactHtml(data: BookingEmailData): string {
  const phone = isDialablePhone(data.facilityPhone) ? data.facilityPhone : null;
  const slug = data.facilitySlug ? data.facilitySlug : null;
  return [
    phone ? `<p style="text-align:center;margin:8px 0;">電話：${phoneLinkHtml(phone)}</p>` : '',
    slug ? `<p style="text-align:center;margin-top:16px;"><a href="${SITE_URL}/facility/${encodeURIComponent(slug)}" style="${EMAIL_BUTTON_STYLE}">店舗ページを見る</a></p>` : '',
  ].join('');
}

/**
 * 電話番号の表示と tel: リンク。isDialablePhone は内線の「#」を許すので、数字以外を消してから
 * リンクにすると「03-1234-5678 #12」が tel:031234567812（別の番号）になっていた。
 * 「#」以降（内線）はダイヤルする番号に含めない＝店舗ページ（href に電話番号をそのまま入れる）でブラウザが
 * 「#」以降をフラグメントとして落とすのと同じ番号に揃える。表示は元の文字列のまま（内線も読める）。
 * 「#」より前に数字が無いときはリンクにしない（tel: に空の番号を入れない）。
 */
function phoneLinkHtml(phone: string): string {
  const dial = phone.split('#')[0].replace(/[^0-9+]/g, '');
  if (!dial) return esc(phone);
  return `<a href="tel:${dial}" style="color:#0369a1;">${esc(phone)}</a>`;
}

/**
 * お客様向け予約メールの末尾（予約の確かめ方）。
 * 以前はゲスト予約（ログインせずに予約）にも「予約を確認する」→ /mypage を出していたが、
 * マイページは user_id で絞るためゲストの予約は表示されず、押しても予約が見つからなかった。
 */
function bookingAccessHtml(data: BookingEmailData, memberLabel: string, finished = false): string {
  const mypageButton = `<p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/mypage" style="${EMAIL_BUTTON_STYLE}">${memberLabel}</a></p>`;
  if (data.hasAccount === true) return mypageButton;
  const facility = esc(data.facilityName);
  if (data.hasAccount === false) {
    // 完了・無断キャンセル・キャンセル済みの予約に「確認・変更・キャンセルは」と案内するのは噛み合わない。
    const sentence = finished
      ? `ご不明な点は、${facility}へご連絡ください。`
      : `ご予約の確認・変更・キャンセルは、${facility}へ直接ご連絡ください。`;
    return `<p style="margin-top:24px;">${sentence}</p>${shopContactHtml(data)}`;
  }
  return `<p style="margin-top:24px;font-size:13px;color:#475569;">ログインしてご予約された方は、マイページでご予約を確認できます。ログインせずにご予約された方は、${facility}へ直接ご連絡ください。</p>${mypageButton}${shopContactHtml(data)}`;
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
 * 対象＝顧客向け＋施設オーナー向けの単発イベント通知（HTTPリクエスト起点の1回送信）で、
 * 他に再送手段が存在しないもの。
 * 上の BULK_AGGREGATED_CONTEXTS（booking_reminder / daily_summary / weekly_report /
 * onboarding_follow / favorites_digest）は各 cron が claim テーブルで「送達失敗時は claim を
 * 解放し翌 run で再送する」独自の再送機構を既に持つため、ここに二重で積むと
 * webhook-retry cron（15分毎）と cron 自身の翌 run 再送が競合し二重配信になり得るため対象外
 * （BULK 系＝claim 機構持ち cron からの送信のみ・二重送信防止で除外を維持）。
 * new_review_notification / new_inquiry_notification / new_booking_notification /
 * booking_cancellation_facility は施設オーナー向けの単発イベント通知で、
 * 従来は失敗時の再送手段が一切無く Slack 警報のみで永久消失していたため、
 * 顧客向けと同様にここへ追加した（2026年7月17日 拡張）。
 * new_question_notification（施設 Q&A の新着質問・2026年10月22日）も同じ種類の通知なので同様に扱う。
 */
const QUEUEABLE_EMAIL_CONTEXTS = new Set([
  'booking_confirmation',
  'booking_rescheduled',
  'time_adjust_request',
  'booking_confirmed',
  'booking_cancelled',
  'booking_status_update',
  'new_booking_notification',
  'booking_cancellation_facility',
  'new_review_notification',
  'new_inquiry_notification',
  'new_question_notification',
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
async function safeSend(
  resend: Resend,
  params: Parameters<Resend['emails']['send']>[0],
  context: string,
  options: { idempotencyKey?: string; requireMessageId?: boolean; redactFailureDetails?: boolean } = {},
): Promise<boolean> {
  if (QUEUEABLE_EMAIL_CONTEXTS.has(context)) {
    return sendDurableEventEmail(resend, toQueuePayload(params) as { from: string; to: string; subject: string; html: string }, context);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fail = (detail: string): false => {
    const safeDetail = options.redactFailureDetails ? 'provider outcome not confirmed' : detail;
    safeCaptureException(new Error(`resend send failed: ${safeDetail}`), `email:${context}`);
    if (!BULK_AGGREGATED_CONTEXTS.has(context)) {
      postAlert({ level: 'error', message: `メール送信失敗(${context}): ${safeDetail}`, route: `email:${context}`, env: process.env.VERCEL_ENV });
    }
    return false;
  };
  try {
    // 監査X7: Resend SDK は自前タイムアウトを持たず、cron の maxDuration/予算ガードは
    // iteration 間でしか効かないため await 中のハングを救えない。Promise.race で 10s 上限を
    // 課し、ハング時は失敗(false)扱いにして一括送信全体のブロックを防ぐ。
    const result = await Promise.race([
      // resend-checked: Promise.race に包んでいるため sendResendChecked/throwIfResendError の
      // 引数位置には直接ネストできない。直後の `if (result && result.error)` で自前に検査し、
      // fail() へ渡している（result.error 未検査のまま返す経路は無い）。
      options.idempotencyKey
        ? resend.emails.send(params, { idempotencyKey: options.idempotencyKey })
        : resend.emails.send(params),
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
    if (options.requireMessageId) {
      const data = result && result.data as { id?: unknown } | null | undefined;
      if (!data || typeof data.id !== 'string' || data.id.length === 0) return fail('provider response missing message id');
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
  return safeSend(resend, buildBookingConfirmationEnvelope(data), 'booking_confirmation');
}

export function buildBookingConfirmationEnvelope(data: BookingEmailData) {
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  return {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】${data.facilityName}のご予約を受け付けました`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}へのご予約を受け付けました。<br>施設からの確認後、確定メールをお送りいたします。</p>
      ${bookingDetailHtml(data)}
      ${bookingAccessHtml(data, '予約を確認する')}
    `),
  };
}

/** 予約日時の変更確認（顧客向け・A-4）。作成/キャンセルと対称に、変更後の新しい日時を顧客へ通知する。 */
export async function sendBookingRescheduled(data: BookingEmailData): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  return safeSend(resend, buildBookingRescheduledEnvelope(data), 'booking_rescheduled');
}

export function buildBookingRescheduledEnvelope(data: BookingEmailData) {
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  return {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】${data.facilityName}のご予約日時を変更しました`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}のご予約日時を下記のとおり変更しました。</p>
      ${bookingDetailHtml(data)}
      ${bookingAccessHtml(data, '予約を確認する')}
    `),
  };
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
  return safeSend(resend, {
    from: FROM,
    to: data.customerEmail,
    ...buildBookingReminderContent(data, daysBefore),
  }, 'booking_reminder');
}

/**
 * リマインドメールの件名と本文（前日・3日前・7日前で共通）。
 * 送信経路が 2 本（sendBookingReminder / sendBookingReminderForCron）あるため、文面はここにだけ置く。
 * 片方にだけ説明文を足すと、届くメールによって書いてあることが違う状態になる。
 *
 * 末尾の説明（REMINDER_EMAIL_TIMING_NOTE）は、リマインドを朝9時に1回だけ送る運用
 * （2026年10月22日 神原さん決定）を受け取った人に伝えるためのもの。前日の9時より後に
 * 予約した人には前日リマインドが届かないので、その理由をメール側に明記する。
 */
export function buildBookingReminderContent(data: BookingEmailData, daysBefore: number) {
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  const when = daysBefore === 1 ? '明日' : `${daysBefore}日後`;
  return {
    subject: escSubject(`【CareLink】${when}のご予約リマインド - ${data.facilityName}`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${when}、${facility}のご予約がございます。</p>
      ${bookingDetailHtml(data)}
      <p>お忘れなく、お時間に余裕を持ってご来店ください。</p>
      ${bookingAccessHtml(data, '予約詳細を見る')}
      <p style="font-size:12px;color:#64748b;margin-top:24px;">${REMINDER_EMAIL_TIMING_NOTE}</p>
    `),
  };
}

/** Cron用は、外部providerの送達結果不明を自動再送に変換しない。 */
export type BookingReminderDeliveryOutcome = 'delivered' | 'rejected' | 'uncertain';

export async function sendBookingReminderForCron(
  data: BookingEmailData,
  daysBefore: number = 1,
): Promise<BookingReminderDeliveryOutcome> {
  const resend = getResend();
  if (!resend) return 'rejected';
  try {
    // Promise.raceのタイムアウトで未送信と断定すると、provider受理済みメールを次runで再送する。
    // cronはclaimを保持して照合へ上げるため、この専用経路ではSDKの終端応答だけを未受理とする。
    return await sendResendForReconciliation(resend.emails.send({
      from: FROM,
      to: data.customerEmail,
      ...buildBookingReminderContent(data, daysBefore),
    }));
  } catch (error) {
    safeCaptureException(error, 'email:booking_reminder_cron_uncertain');
    return 'uncertain';
  }
}

/**
 * 予約時間調整のお願い（施設→顧客）
 * SB の予約詳細から送信する。メール送信は無料（LINE 送信は有料オプション）。
 */
export async function sendTimeAdjustRequest(data: BookingEmailData): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  return safeSend(resend, buildTimeAdjustRequestEnvelope(data), 'time_adjust_request');
}

/**
 * 時間調整のお願いで、お客様にお願いする手段。ゲスト予約はマイページで変更できないので、店舗への連絡だけをお願いする
 * （以前はゲストにも「マイページの予約変更」と「予約を変更する」ボタンを出していた）。
 */
function timeAdjustActionHtml(data: BookingEmailData): string {
  const facility = esc(data.facilityName);
  if (data.hasAccount === true) {
    return `<p>恐れ入りますが、マイページの予約変更または施設へのご連絡にて、ご都合の良いお時間をお知らせください。</p>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/mypage" style="${EMAIL_BUTTON_STYLE}">予約を変更する</a></p>`;
  }
  if (data.hasAccount === false) {
    return `<p>恐れ入りますが、${facility}へ直接ご連絡のうえ、ご都合の良いお時間をお知らせください。</p>${shopContactHtml(data)}`;
  }
  return `<p>恐れ入りますが、${facility}へのご連絡にて、ご都合の良いお時間をお知らせください（ログインしてご予約された方は、マイページから予約を変更することもできます）。</p>${shopContactHtml(data)}`;
}

export function buildTimeAdjustRequestEnvelope(data: BookingEmailData) {
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  return {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】ご予約時間調整のお願い - ${data.facilityName}`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}より、ご予約のお時間について調整のお願いがございます。</p>
      ${bookingDetailHtml(data)}
      ${timeAdjustActionHtml(data)}
    `),
  };
}

/** 予約確定通知（顧客向け） */
export async function sendBookingConfirmed(data: BookingEmailData): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  return safeSend(resend, buildBookingConfirmedEnvelope(data), 'booking_confirmed');
}

/** Pure builder shared by the durable manual-booking outbox. */
export function buildBookingConfirmedEnvelope(data: BookingEmailData) {
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  return {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】${data.facilityName}のご予約が確定しました`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}のご予約が<strong style="color:#16a34a;">確定</strong>しました。</p>
      ${bookingDetailHtml(data)}
      <p>当日のご来店をお待ちしております。</p>
      ${bookingAccessHtml(data, '予約詳細を見る')}
    `),
  };
}

/** 予約キャンセル通知（顧客向け） */
export async function sendBookingCancelled(data: BookingEmailData): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  return safeSend(resend, buildBookingCancelledEnvelope(data), 'booking_cancelled');
}

export function buildBookingCancelledEnvelope(data: BookingEmailData) {
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);
  return {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】${data.facilityName}のご予約がキャンセルされました`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}のご予約がキャンセルされました。</p>
      ${bookingDetailHtml(data)}
      ${data.cancelFee && data.cancelFee > 0 ? `<div style="margin:16px 0;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:14px;">キャンセルポリシーにより、キャンセル料として <strong>¥${data.cancelFee.toLocaleString()}</strong> が発生します。お支払い方法は施設より直接ご案内いたします。</div>` : ''}
      <p>またのご利用をお待ちしております。</p>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/search" style="${EMAIL_BUTTON_STYLE}">他のサロンを探す</a></p>
    `),
  };
}

/** 新着口コミ通知（施設向け・email_on_review 設定で制御。push_on_review は Push だけを止める） */
export async function sendNewReviewNotification(data: {
  facilityEmail: string;
  facilityName: string;
  reviewerName: string;
  rating: number;
  comment?: string | null;
  /** 口コミが投稿された店舗。管理画面へのリンクに付け、複数店舗のオーナーが別の店舗を開かないようにする。 */
  facilityId?: string | null;
  /**
   * 運営の確認が終わるまで公開されない口コミか（医療広告ガイドラインの禁止表現を含む等）。
   * 以前は書き添えておらず、店舗は届いた口コミが店舗ページに出ない理由を知る手段が無かった（2026年10月23日）。
   */
  pendingModeration?: boolean;
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
      ${data.pendingModeration ? '<p>この口コミは運営の確認が終わるまで、店舗ページと評価には反映されません。</p>' : ''}
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:120px;">投稿者</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${name}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">評価</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">★${data.rating}</td></tr>
        ${comment ? `<tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">コメント</td><td style="padding:8px 12px;border:1px solid #e2e8f0;white-space:pre-wrap;">${comment}</td></tr>` : ''}
      </table>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}${adminFacilityHref('/admin/reviews', data.facilityId ?? null)}" style="${EMAIL_BUTTON_STYLE}">管理画面で確認する</a></p>
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
/**
 * お問い合わせへの返信（運営 → 問い合わせ者）。
 *
 * 【2026年7月28日 新設・恒久根治】管理画面の返信ボタンは mailto: リンクで、担当者の
 * メールアプリを開くだけだった。そのため返信は個人の Gmail アカウントから送られ、
 * 問い合わせ者には運営の個人アドレスが差出人として見えていた（/legal に記載した
 * support@carelink-jp.com に問い合わせたのに別アドレスから返信が来る状態）。
 * ここから送れば差出人は常に EMAIL_FROM（carelink-jp.com の検証済みドメイン）に固定される。
 *
 * replyTo に運営アドレスを入れるのは、問い合わせ者が返信したときに
 * Cloudflare Email Routing 経由で運営に届く経路を保つため。
 */
export async function sendInquiryReply(data: {
  to: string;
  inquirerName: string;
  body: string;
  idempotencyKey: string;
  replyTo?: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  return safeSend(resend, {
    from: FROM,
    to: data.to,
    // 問い合わせ者が返信したら運営に戻るようにする（未指定なら FROM のまま）。
    replyTo: data.replyTo || FROM,
    subject: escSubject('【CareLink】お問い合わせへのご返信'),
    html: wrapHtml(`
      <p>${esc(data.inquirerName)} 様</p>
      <p>CareLink へお問い合わせいただきありがとうございます。</p>
      <div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">${esc(data.body)}</div>
      <p style="color:#64748b;font-size:13px;">このメールにそのまま返信していただけます。</p>
    `),
  }, 'inquiry_reply', {
    idempotencyKey: data.idempotencyKey,
    requireMessageId: true,
    redactFailureDetails: true,
  });
}

export function buildInquiryReplyEnvelope(data: { to: string; inquirerName: string; body: string }): InquiryReplyEnvelope {
  return {
    from: FROM, to: data.to, replyTo: FROM,
    subject: escSubject('【CareLink】お問い合わせへのご返信'),
    html: wrapHtml(`
      <p>${esc(data.inquirerName)} 様</p>
      <p>CareLink へお問い合わせいただきありがとうございます。</p>
      <div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">${esc(data.body)}</div>
      <p style="color:#64748b;font-size:13px;">このメールにそのまま返信していただけます。</p>
    `),
  };
}

export function deliverInquiryReply(envelope: InquiryReplyEnvelope, operationId: string) {
  return sendInquiryReplyEnvelope(getResend(), envelope, operationId);
}

export function reconcileInquiryReply(envelope: InquiryReplyEnvelope, operationId: string, messageId: string, reservedAt: string) {
  return verifyInquiryReplyAcceptance(getResend(), envelope, operationId, messageId, reservedAt);
}

export async function sendNewInquiryNotification(data: {
  facilityEmail: string;
  facilityName: string;
  inquirerName: string;
  inquirerEmail: string;
  inquirerPhone?: string | null;
  message: string;
  /** 問い合わせ先の店舗。管理画面へのリンクに付け、複数店舗のオーナーが別の店舗を開かないようにする。 */
  facilityId?: string | null;
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
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}${adminFacilityHref('/admin/facility-inquiries', data.facilityId ?? null)}" style="${EMAIL_BUTTON_STYLE}">管理画面で確認する</a></p>
    `),
  }, 'new_inquiry_notification');
}

/**
 * 施設 Q&A に質問が投稿されたことを店舗（owner / admin）へ知らせる（2026年10月22日）。
 * 以前は質問がブラウザから保存されるだけで誰にも通知されず、店舗が自分で /admin/qa を
 * 開かない限り気づけなかった（来院者には「施設からの回答をお待ちください」と表示したまま）。
 * 質問者のアカウント情報は載せない（回答に必要なのは質問文だけ）。
 */
export async function sendNewQuestionNotification(data: {
  facilityEmail: string;
  facilityName: string;
  question: string;
  /** 質問が投稿された店舗。管理画面へのリンクに付け、複数店舗のオーナーが別の店舗を開かないようにする。 */
  facilityId: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  return safeSend(resend, {
    from: FROM,
    to: data.facilityEmail,
    subject: escSubject(`【CareLink】Q&Aに新しい質問が届きました - ${data.facilityName}`),
    html: wrapHtml(`
      <p>${esc(data.facilityName)}の店舗ページのQ&amp;Aに、新しい質問が届きました。管理画面から回答してください。</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:120px;">質問</td><td style="padding:8px 12px;border:1px solid #e2e8f0;white-space:pre-wrap;">${esc(data.question)}</td></tr>
      </table>
      <p style="font-size:13px;color:#475569;">回答すると、質問と回答が店舗ページのQ&amp;Aに公開されます（公開は管理画面でいつでも止められます）。</p>
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}${adminFacilityHref('/admin/qa', data.facilityId)}" style="${EMAIL_BUTTON_STYLE}">管理画面で回答する</a></p>
    `),
  }, 'new_question_notification');
}

/** 運営向けメール通知。宛先は OPERATOR_NOTIFY_EMAIL（カンマ区切りで複数可）。 */
export async function sendOperatorNotification(data: {
  subject: string;
  lines: { label: string; value: string }[];
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  const to = (process.env.OPERATOR_NOTIFY_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (to.length === 0) return false;
  const rows = data.lines.map((l) =>
    `<tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:120px;">${esc(l.label)}</td><td style="padding:8px 12px;border:1px solid #e2e8f0;white-space:pre-wrap;">${esc(l.value)}</td></tr>`
  ).join('');
  return safeSend(resend, {
    from: FROM,
    to,
    subject: escSubject(data.subject),
    html: wrapHtml(`<table style="width:100%;border-collapse:collapse;margin:16px 0;">${rows}</table>`),
  }, 'operator_notification');
}

/** 新規予約通知（施設向け） */
export async function sendNewBookingNotification(data: BookingEmailData & { facilityEmail: string }): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  return safeSend(resend, buildNewBookingNotificationEnvelope(data), 'new_booking_notification');
}

export function buildNewBookingNotificationEnvelope(data: BookingEmailData & { facilityEmail: string }) {
  const name = esc(data.customerName);
  const email = esc(data.customerEmail);
  const introduction = data.bookingStatus === 'confirmed'
    ? '新しい予約が確定しました。管理画面から内容をご確認ください。'
    : '新しい予約が入りました。管理画面から確認・承認してください。';
  // 電話番号と備考（訪問専門の店舗では訪問先の住所）は店舗が動くのに要る情報なので、
  // 管理画面を開かなくてもメールで分かるようにする（2026年10月22日・神原さん判断）。
  const rowStyle = 'padding:8px 12px;border:1px solid #e2e8f0;';
  const headStyle = `${rowStyle}background:#f8fafc;font-weight:600;`;
  const phone = data.customerPhone?.trim();
  const note = data.note?.trim();
  const contactRows = [
    phone ? `<tr><td style="${headStyle}">電話番号</td><td style="${rowStyle}">${esc(phone)}</td></tr>` : '',
    note ? `<tr><td style="${headStyle}">ご要望・備考<br><span style="font-weight:400;font-size:12px;">（訪問先のご住所を含む）</span></td><td style="${rowStyle}white-space:pre-wrap;">${esc(note)}</td></tr>` : '',
  ].join('');
  return {
    from: FROM,
    to: data.facilityEmail,
    subject: escSubject(`【CareLink】新しい予約が入りました - ${data.customerName}様`),
    html: wrapHtml(`
      <p>${introduction}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:120px;">お客様名</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${name}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">メール</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${email}</td></tr>
        ${contactRows}
      </table>
      ${bookingDetailHtml(data)}
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin/bookings" style="${EMAIL_BUTTON_STYLE}">管理画面で確認する</a></p>
    `),
  };
}

/** 予約キャンセル通知（施設向け） */
export async function sendBookingCancellationToFacility(data: BookingEmailData & { facilityEmail: string }): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  return safeSend(resend, buildBookingCancellationToFacilityEnvelope(data), 'booking_cancellation_facility');
}

export function buildBookingCancellationToFacilityEnvelope(data: BookingEmailData & { facilityEmail: string }) {
  const name = esc(data.customerName);
  const email = esc(data.customerEmail);
  const rowStyle = 'padding:8px 12px;border:1px solid #e2e8f0;';
  const headStyle = `${rowStyle}background:#f8fafc;font-weight:600;`;
  const fee = data.cancelFee && data.cancelFee > 0 ? data.cancelFee : 0;
  // お客様向けのキャンセル通知（buildBookingCancelledEnvelope）は、キャンセル料が発生することと、お支払い方法は
  // 施設から直接案内することを伝えている。以前は店舗にその事実も金額も届かず、お客様は案内を待ったままになっていた
  // （同じ snapshot から算出した同じ金額を載せる）。
  const rateText = data.cancelFeeRate && data.cancelFeeRate > 0 ? `（施術料金の${data.cancelFeeRate}%）` : '';
  const receiptRows = [
    data.cancelledAt ? `<tr><td style="${headStyle}">キャンセル受付</td><td style="${rowStyle}">${formatJstDateTime(data.cancelledAt)}</td></tr>` : '',
    fee > 0 ? `<tr><td style="${headStyle}">キャンセル料</td><td style="${rowStyle}">&yen;${fee.toLocaleString()}${rateText}</td></tr>` : '',
  ].join('');
  const feeAmount = `<strong>&yen;${fee.toLocaleString()}</strong>`;
  // メールアドレスの無いお客様には、お客様宛のキャンセル通知そのものが積まれない（店舗宛だけが届く）。
  // その場合に「お知らせしています」と書くと、店舗は連絡を待ち、お客様は料金を知らないままになる。
  const feeMessage = isCustomerEmailRecipient(data.customerEmail)
    ? `キャンセルポリシーにより、お客様へキャンセル料 ${feeAmount} の発生と、お支払い方法は施設から直接ご案内することをメールでお知らせしています。お支払い方法をお客様へ直接ご連絡ください。`
    : `お客様のメールアドレスの登録が無いため、キャンセル料はお客様へメールでお知らせしていません。キャンセル料 ${feeAmount} とお支払い方法を、お客様へ直接ご案内ください。`;
  const feeNotice = fee > 0
    ? `<div style="margin:16px 0;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:14px;">${feeMessage}</div>`
    : '';
  return {
    from: FROM,
    to: data.facilityEmail,
    subject: escSubject(`【CareLink】予約がキャンセルされました - ${data.customerName}様`),
    html: wrapHtml(`
      <p>下記のご予約がキャンセルされました。管理画面で予約状況をご確認ください。</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:120px;">お客様名</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${name}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">メール</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${email}</td></tr>
        ${receiptRows}
      </table>
      ${feeNotice}
      ${bookingDetailHtml(data)}
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin/bookings" style="${EMAIL_BUTTON_STYLE}">管理画面で確認する</a></p>
    `),
  };
}

/**
 * 予約日時の変更通知（施設向け）。お客様がマイページで日時を変更したときに、キャンセル通知と
 * 同じ店舗の宛先へ送る。以前は店舗に何も届かず、変更前の時間に来店を待ってしまう状態だった。
 * 送信は webhook-retry の worker だけが行う（変更と同じトランザクションで積まれた snapshot から組み立てる）。
 */
export function buildBookingRescheduleToFacilityEnvelope(
  data: BookingEmailData & { facilityEmail: string; previous: { bookingDate: string; startTime: string; endTime: string } },
) {
  const name = esc(data.customerName);
  const email = esc(data.customerEmail);
  const before = `${formatDate(data.previous.bookingDate)} ${formatTime(data.previous.startTime)}〜${formatTime(data.previous.endTime)}`;
  return {
    from: FROM,
    to: data.facilityEmail,
    subject: escSubject(`【CareLink】予約日時が変更されました - ${data.customerName}様`),
    html: wrapHtml(`
      <p>お客様がご予約の日時を変更しました。管理画面で予約状況をご確認ください。</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:120px;">お客様名</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${name}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">メール</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${email}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">変更前の日時</td><td style="padding:8px 12px;border:1px solid #e2e8f0;">${before}</td></tr>
      </table>
      <p style="font-weight:600;margin-bottom:0;">変更後のご予約内容</p>
      ${bookingDetailHtml(data)}
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin/bookings" style="${EMAIL_BUTTON_STYLE}">管理画面で確認する</a></p>
    `),
  };
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
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin/analytics" style="${EMAIL_BUTTON_STYLE}">分析を見る</a></p>
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
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin/analytics" style="${EMAIL_BUTTON_STYLE}">分析を見る</a></p>
    `),
  }, 'weekly_report');
}

/** 施設オーナー向け3日後フォローメール（未完了項目のリマインド） */
/**
 * 登録3日後のフォローメール。項目は /admin の「店舗セットアップ」と同じ単一ソース
 * （facility-setup-steps.ts）から作られ、文言も画面と同じにする（メールと画面で項目がずれないため）。
 * missingSteps＝無料掲載の公開に要る項目、bookingSteps＝ネット予約を受けるのに要る項目。
 */
export async function sendOnboardingFollowEmail(data: {
  ownerEmail: string;
  facilityName: string;
  missingSteps: string[];
  bookingSteps?: string[];
}) {
  const resend = getResend();
  // API キー未設定は送達不可＝false（cron 側で未送信扱い）。
  if (!resend) return false;
  const facility = esc(data.facilityName);
  const list = (steps: string[]) => `<ul style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:16px 16px 16px 32px;margin:8px 0 16px;">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
  const bookingSteps = data.bookingSteps ?? [];
  const listing = data.missingSteps.length > 0
    ? `<p style="margin:16px 0 0;"><strong>無料掲載の公開に必要な項目</strong></p>${list(data.missingSteps)}`
    : '';
  const booking = bookingSteps.length > 0
    ? `<p style="margin:16px 0 0;"><strong>ネット予約の受付に必要な項目</strong>（掲載だけのご利用なら不要です）</p>${list(bookingSteps)}`
    : '';
  return safeSend(resend, {
    from: FROM,
    to: data.ownerEmail,
    subject: escSubject(`【CareLink】${data.facilityName}の設定があと少しです`),
    html: wrapHtml(`
      <p>${facility}の${T.account}を作成いただいてから数日が経ちました。</p>
      <p>管理画面の「店舗セットアップ」で、次の項目がまだ完了していません。</p>
      ${listing}${booking}
      <p style="text-align:center;margin-top:24px;"><a href="${SITE_URL}/admin" style="${EMAIL_BUTTON_STYLE}">管理画面で設定を完了する</a></p>
    `),
  }, 'onboarding_follow');
}

export async function sendBookingStatusUpdate(data: BookingEmailData & { newStatus: string; reason?: string }): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  return safeSend(resend, buildBookingStatusUpdateEnvelope(data), 'booking_status_update');
}

export function buildBookingStatusUpdateEnvelope(data: BookingEmailData & { newStatus: string; reason?: string }) {

  const statusLabel = bookingStatusLabel(data.newStatus);
  const name = esc(data.customerName);
  const facility = esc(data.facilityName);

  return {
    from: FROM,
    to: data.customerEmail,
    subject: escSubject(`【CareLink】予約ステータスが「${statusLabel}」に変更されました`),
    html: wrapHtml(`
      <p>${name} 様</p>
      <p>${facility}のご予約のステータスが<strong>「${statusLabel}」</strong>に変更されました。</p>
      ${data.reason ? `<p style="background:#fef3c7;padding:12px;border-radius:8px;font-size:14px;">理由: ${esc(data.reason)}</p>` : ''}
      ${bookingDetailHtml(data)}
      ${bookingAccessHtml(data, '予約を確認する', !canCustomerCancelBooking(data.newStatus))}
    `),
  };
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
  return safeSend(resend, buildFavoritesDigestEnvelope(data), 'favorites_digest');
}

export function buildFavoritesDigestEnvelope(data: {
  userEmail: string;
  userName?: string;
  facilities: { name: string; slug: string; newCoupons: number; hasNewMenus: boolean }[];
  unsubscribeToken?: string;
}) {

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

  return {
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
        <a href="${SITE_URL}/mypage/favorites" style="${EMAIL_BUTTON_STYLE}">
          お気に入りを見る
        </a>
      </p>
    `, data.unsubscribeToken),
  };
}

/** Pure template for the booking-owned durable review invitation. */
export function buildReviewRequestEnvelope(data: {
  email: string; customerName: string | null; facilityName: string; facilitySlug: string;
  /**
   * 予約の user_id（予約確保時の snapshot の userId）。null はゲスト予約、未指定は分からない。
   * 口コミポイント（50pt）は、ログインした会員がその店舗で来店済みの予約を持つときに、店舗ごとに初回の 1 回だけ付く
   * （commit_review_effects トリガ）。ゲストや不明の相手にはポイントを約束しない。
   */
  userId?: string | null;
}) {
  // 以前は #review を指していたが、施設ページにその id は無く、口コミタブも開かれなかった
  // （押してもトップタブのまま）。#review-form は ReviewTab の投稿欄の id で、TabNavigation が
  // それを含む口コミタブを開いてスクロールする（#review も口コミタブを開く）。
  const reviewUrl = `${SITE_URL}/facility/${encodeURIComponent(data.facilitySlug)}#review-form`;
  // 以前は全員に「口コミを投稿すると50ポイントがもらえます！」と書いていたが、ゲスト予約の方や、
  // その店舗に既に口コミを書いた会員には付かない。会員の予約にだけ、条件を添えて案内する。
  const pointsNote = data.userId
    ? '<p style="color:#64748b;font-size:12px;">ご予約の会員アカウントでログインして投稿すると、この店舗への初めての口コミに50ポイントを差し上げます。</p>'
    : '';
  return { from: FROM, to: data.email,
    subject: escSubject(`【${data.facilityName}】ご来店ありがとうございました`),
    html: `<p>${esc(data.customerName || 'お客')}様</p><p>先日は<strong>${esc(data.facilityName)}</strong>にご来店いただきありがとうございました。</p><p>よろしければ、口コミを投稿していただけると嬉しいです。</p><p><a href="${reviewUrl}" style="display:inline-block;padding:12px 24px;background:#0284C7;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">口コミを書く</a></p>${pointsNote}`,
  };
}

// ---------------------------------------------------------------------------
// 掲載登録（/register）の申込者向けフォローメール
//
// 🔴 なぜ足したか（2026年8月20日・実データで確定）
// 本番の salons は 8 件あるのに facility_profiles は 3 件しかなかった。差の 5 件は
// 「登録フォームは送ったが、アカウント作成まで到達しなかった」申込者で、
// onboarding-followup cron は facility_profiles だけを対象にしていたため、
// この 5 件は【どこからも接触されないまま放置】されていた。
//
// 🔴 2026年10月22日: リンク先を /register/recover（送信済みの掲載申込を復旧）へ変更した。
// それまでのリンクは /admin/onboarding?facility_name=…&business_type=… で、受付を特定する
// 情報を何も運ばなかった。受付 V2 の引き継ぎ（同じタブの intent）は 72 時間で失効し、
// このメールは申込から 3 日以上後に届くので、リンクから進むと申込内容（写真・営業時間・
// PR 文・所在地）を一切取り込まない空の店舗が作られた。しかも一度店舗を作ると、
// 後から /register/recover で申込を選んでも ALREADY_MEMBER で取り込めなくなる。
// 本文の「入力し直す必要はありません」も、その時点では事実ではなかった。
// /register/recover は申込時の【確認済みメールアドレス】で受付を一覧し、選んだ申込を
// そのまま引き継ぐ（メールに選択子や証明を載せずに済む唯一の安全な経路）。
//
// 受付直後のメールは salon-outbox-delivery.ts が送る。呼び出し元の無くなった旧受付メール
// （sendRegistrationReceiptEmail）は同じ誤ったリンクと約束を持っていたため削除した。
// ---------------------------------------------------------------------------

/**
 * 掲載申込者向けのフォローメール（数日後・まだアカウントを作っていない人だけ）。
 *
 * 送信対象の判定は cron 側（onboarding-followup）が行う。ここは文面だけを持つ。
 * 施設はまだ存在しない（facility_profiles が無い）ので、管理画面ではなく
 * 「アカウント作成 → 送信済みの掲載申込を復旧」へ導く点が sendOnboardingFollowEmail と異なる。
 */
export async function sendRegistrationLeadFollowEmail(data: {
  email: string;
  facilityName: string;
  receiptId: string;
}): Promise<boolean> {
  const resend = getResend();
  // API キー未設定は送達不可＝false（cron 側で未送信扱いに戻す）。
  if (!resend) return false;
  const signupUrl = SITE_URL + salonRecoveryAuthPath('signup');
  const loginUrl = SITE_URL + salonRecoveryAuthPath('login');
  const facility = esc(data.facilityName);
  const addr = esc(data.email);
  const receipt = esc(data.receiptId);
  return safeSend(resend, {
    from: FROM,
    to: data.email,
    subject: escSubject(`【CareLink】${data.facilityName}の掲載準備が途中のままです`),
    html: wrapHtml(`
      <p>${facility} の${T.application}をいただきましたが、${T.account}の作成がまだのようです。</p>
      <p style="font-size:13px;color:#475569;">受付番号：${receipt}</p>
      <p>申込時と同じメールアドレスで${T.account}を作成し、メールアドレスの確認を済ませると、
         「送信済みの掲載申込を復旧」の画面にこの申込が表示されます。申込を選ぶと、入力いただいた
         写真・営業時間・PR文などを引き継いで${T.shop}を作成できます。</p>
      <div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0;"><strong>このメールを受け取ったアドレスで作成してください。</strong></p>
        <p style="margin:8px 0 0;">${addr}</p>
        <p style="margin:8px 0 0;font-size:13px;color:#713f12;">
          別のアドレスで作成すると申込が表示されず、内容を引き継げません。</p>
      </div>
      <p style="text-align:center;margin-top:24px;"><a href="${esc(signupUrl)}" style="${EMAIL_BUTTON_STYLE}">${T.account}を作成して申込を再開する</a></p>
      <p style="font-size:13px;color:#475569;">すでにアカウントをお持ちの場合は、<a href="${esc(loginUrl)}" style="color:#0369a1;">ログインして申込を再開</a>してください。</p>
      <p style="font-size:13px;color:#475569;">申込が表示されない場合は、新しく${T.shop}を作成したり申し込み直したりせず、受付番号を添えて<a href="${SITE_URL}/contact" style="color:#0369a1;">お問い合わせ</a>ください。</p>
    `),
  }, 'registration_lead_follow');
}
