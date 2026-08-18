/**
 * LINE Messaging API ユーティリティ（v8.0）
 * salon-absence-system の line_utils.py 相当をTypeScriptで実装
 */

import crypto from 'crypto';
import { enqueueWebhook } from '@/lib/webhook-queue';
import { runAfterResponse } from '@/lib/after-response';

const LINE_API_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

/**
 * 検証に使う自社 LINE Login / LIFF チャネルIDを取得する。
 *
 * サーバ専用 env `LINE_LOGIN_CHANNEL_ID` を優先し、無ければ既存の
 * `NEXT_PUBLIC_LINE_CHANNEL_ID`（LINE Login チャネルIDと同値）へフォールバックする。
 * 本番(production)で両方未設定なら、検証不能 = fail-closed のため null を返す。
 */
export function getLineLoginChannelId(): string | null {
  const id =
    process.env.LINE_LOGIN_CHANNEL_ID ||
    process.env.NEXT_PUBLIC_LINE_CHANNEL_ID ||
    null;
  return id && id.trim() !== '' ? id : null;
}

/**
 * LINE アクセストークンの正当性を oauth2/v2.1/verify で検証する。
 *
 * `/v2/profile` は「トークンが有効か」しか見ず、どのチャネルで発行された
 * トークンか（audience / client_id）を検証しない。攻撃者が自前チャネルで
 * 取得したトークンで被害者の line_user_id を名乗れてしまうため、
 * verify エンドポイントで `client_id` が自社チャネルIDと一致することを必須化する。
 *
 * 成功条件: HTTP200 かつ `client_id === 自社チャネルID` かつ `expires_in > 0`。
 * 失敗・例外・チャネルID未設定はすべて fail-closed で `{ ok: false }` を返す。
 */
export async function verifyLineAccessToken(
  accessToken: string
): Promise<{ ok: boolean; userId?: string }> {
  const expectedChannelId = getLineLoginChannelId();
  if (!expectedChannelId) {
    // チャネルID未設定 = 検証不能。fail-closed で拒否する。
    console.error('[LINE] verifyLineAccessToken: channel id not configured');
    return { ok: false };
  }

  if (!accessToken || typeof accessToken !== 'string') {
    return { ok: false };
  }

  try {
    const res = await fetch(
      `${LINE_VERIFY_URL}?access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) {
      return { ok: false };
    }
    const body = (await res.json()) as {
      client_id?: string;
      expires_in?: number;
    };
    if (
      body.client_id === expectedChannelId &&
      typeof body.expires_in === 'number' &&
      body.expires_in > 0
    ) {
      return { ok: true };
    }
    return { ok: false };
  } catch (e) {
    console.error('[LINE] verifyLineAccessToken error:', e);
    return { ok: false };
  }
}

function getToken(): string {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN_CARELINK is not set');
  return token;
}

interface LineMessage {
  type: string;
  text?: string;
  altText?: string;
  contents?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * LINE 送信の結果。
 *
 * 🔴 なぜ boolean では足りないか（Issue #417）
 * 送信失敗には【もう一度試せば届くもの】と【何度試しても永久に届かないもの】がある。
 * 後者は宛先がブロック済み・連携解除済み・user_id が無効といった場合で、LINE API は 4xx を返す。
 * sendLinePush は以前からこの区別を持っていたのに、呼び出し側へは false としか渡していなかった。
 * そのため cron 側は恒久エラーでも「失敗＝翌 run で再送」と扱い、【毎回失敗する送信を永久に
 * 繰り返しながら、その予約者には一生届かない】状態になり得た。区別を呼び出し側まで運ぶ。
 */
export type LineDeliveryOutcome =
  /** 届いた。 */
  | 'delivered'
  /** 一時的な失敗（429 レート制限・5xx・ネットワーク）。再送する価値がある。 */
  | 'transient'
  /** 恒久的な失敗（4xx。宛先が無効・ブロック等）。同じ宛先へ再送しても届かない。 */
  | 'permanent';

/**
 * LINE Push メッセージ送信（リトライ付き・結果の詳細つき）。
 *
 * 送達可否だけで良い呼び出し側は sendLinePush（boolean 版）を使う。
 * 「届かない相手に永久に再送し続けない」判断が要る呼び出し側だけがこちらを使う。
 */
export async function sendLinePushWithOutcome(
  lineUserId: string,
  messages: LineMessage[],
  maxRetries = 3
): Promise<LineDeliveryOutcome> {
  const token = getToken();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(LINE_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to: lineUserId, messages }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) return 'delivered';

      const errorText = await res.text().catch(() => '');
      console.error(`[LINE] Push failed: ${res.status} ${errorText}`);

      // 4xx（429除く）は無効な user_id / 不正メッセージ等の恒久エラー。リトライしても解決せず
      // LINE API へ無駄なリクエストを連打するだけなので即座に false を返す。
      // 429(レート制限) と 5xx(一時障害) は下のバックオフでリトライする。
      // （res.ok=false を通過後のため status は非2xx/3xx。< 500 かつ 429 でなければ 4xx 恒久エラー）
      if (res.status < 500 && res.status !== 429) {
        return 'permanent';
      }

      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
      }
    } catch (e) {
      console.error(`[LINE] Push error (attempt ${attempt + 1}):`, e);
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  // リトライ上限に到達。恒久エラーならこのループの中で既に 'permanent' を返しているので、
  // ここへ来るのは 429 / 5xx / ネットワーク例外＝時間をおけば届き得るものだけ。
  return 'transient';
}

/**
 * LINE Push メッセージ送信（リトライ付き）。
 * 従来からの戻り値契約（送達できたら true・失敗は false）を保つ薄い包み。
 */
export async function sendLinePush(
  lineUserId: string,
  messages: LineMessage[],
  maxRetries = 3
): Promise<boolean> {
  return (await sendLinePushWithOutcome(lineUserId, messages, maxRetries)) === 'delivered';
}

/**
 * テキストメッセージ送信（簡易版）
 *
 * 戻り値契約：外部送信ヘルパー（本関数・sendPush 系・sendXxxNotification 等）は送信失敗
 * （リトライ上限到達）時も throw せず false を返す。呼び出し側は返り値を必ず受け、成功時のみ
 * 送達フラグ（delivered / sent_at 等）を確定すること。false を無視して送達済みにすると、
 * claim 解放による再送が発火せず配信が無音で永久消失する。新しい cron / 通知経路を足す時は
 * 既存の webhook-retry / birthday-coupon と同じ `const ok = await sendX(); if (ok) …` 流儀に揃える。
 *
 * opts.enqueueOnFailure=true を渡すと、送信失敗（false）時に webhook_retry_queue へ登録し
 * 15分毎の webhook-retry cron に自動再送させる。既定は enqueue しない（省略時は従来と完全に
 * 同一の挙動・戻り値契約）。review-request / birthday-coupon 等の cron から直接呼ぶ経路は
 * 各 cron 自身が独自の翌 run 再送（claim 解放 / 送達記録テーブル）を既に持つため opts を渡さず
 * 従来どおり（webhook-retry と二重に積むと二重配信になり得るため意図的に対象外）。
 */
export async function sendLineText(
  lineUserId: string,
  text: string,
  opts?: { enqueueOnFailure?: boolean; facilityId?: string | null }
): Promise<boolean> {
  const ok = await sendLinePush(lineUserId, [{ type: 'text', text }]);
  if (!ok && opts?.enqueueOnFailure) {
    runAfterResponse(() => enqueueWebhook({
      type: 'line_push',
      targetId: lineUserId,
      payload: { message: text },
      facilityId: opts.facilityId ?? null,
    }));
  }
  return ok;
}

/**
 * 予約確認通知を送信
 *
 * 呼び出し元（booking作成・予約ステータス更新等）は単発のHTTPリクエスト起点の送信で、
 * cron による翌run再送のような他の再送手段を持たないため、送信失敗時は
 * webhook_retry_queue へ積んで自動再送する。
 */
export async function sendBookingConfirmation(
  lineUserId: string,
  booking: {
    facilityName: string;
    menuName: string;
    date: string;
    time: string;
    staffName?: string;
  }
): Promise<boolean> {
  const staffLine = booking.staffName ? `\n担当: ${booking.staffName}` : '';
  const text = `✅ 予約を受け付けました\n\n📍 ${booking.facilityName}\n📋 ${booking.menuName}\n📅 ${booking.date} ${booking.time}${staffLine}\n\nご来店をお待ちしております。`;
  return sendLineText(lineUserId, text, { enqueueOnFailure: true });
}

/**
 * 予約キャンセル通知を送信
 *
 * sendBookingConfirmation 同様、単発送信で他の再送手段が無いため失敗時は自動再送キューへ積む。
 */
export async function sendBookingCancellation(
  lineUserId: string,
  booking: {
    facilityName: string;
    menuName: string;
    date: string;
    time: string;
  }
): Promise<boolean> {
  const text = `❌ 予約がキャンセルされました\n\n📍 ${booking.facilityName}\n📋 ${booking.menuName}\n📅 ${booking.date} ${booking.time}`;
  return sendLineText(lineUserId, text, { enqueueOnFailure: true });
}

/**
 * 予約リマインド通知を送信。
 *
 * 🔴 この関数だけ boolean ではなく LineDeliveryOutcome を返す（Issue #417）。
 * 呼び出し元は booking-reminder cron の 1 箇所だけで、そこは「恒久エラーなら再送をやめて
 * メールへ退避する」判断を要する。boolean にすると恒久／一時の区別が呼び出し側で失われ、
 * 届かない相手へ永久に再送し続ける（＝その予約者には一生届かない）状態が復活する。
 * 型で受け取らざるを得なくしてあるので、分岐の書き忘れはコンパイルで止まる。
 */
export async function sendBookingReminder(
  lineUserId: string,
  booking: {
    facilityName: string;
    menuName: string;
    date: string;
    time: string;
    staffName?: string;
    /** 何日前リマインドか（1=明日・既定 / 3=3日後 / 7=7日後 の文言） */
    daysBefore?: number;
  }
): Promise<LineDeliveryOutcome> {
  const staffLine = booking.staffName ? `\n担当: ${booking.staffName}` : '';
  const days = booking.daysBefore ?? 1;
  const when = days === 1 ? '明日' : `${days}日後`;
  const text = `🔔 ${when}のご予約リマインド\n\n📍 ${booking.facilityName}\n📋 ${booking.menuName}\n📅 ${booking.date} ${booking.time}${staffLine}\n\nお気をつけてお越しください。`;
  return sendLinePushWithOutcome(lineUserId, [{ type: 'text', text }]);
}

/**
 * LINE Webhook 署名検証
 * タイミング攻撃防止のため timingSafeEqual を使用
 */
export function verifyLineSignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET_CARELINK;
  if (!secret) throw new Error('LINE_CHANNEL_SECRET_CARELINK is not set');

  const hash = crypto
    .createHmac('SHA256', secret)
    .update(body)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    // Buffer lengths differ → signature is definitely invalid
    return false;
  }
}

/**
 * Reply メッセージ送信（Webhook応答用）
 */
export async function sendLineReply(
  replyToken: string,
  messages: LineMessage[]
): Promise<boolean> {
  const token = getToken();
  try {
    const res = await fetch(LINE_REPLY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ replyToken, messages }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (e) {
    console.error('[LINE] Reply error:', e);
    return false;
  }
}
