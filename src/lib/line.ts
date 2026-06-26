/**
 * LINE Messaging API ユーティリティ（v8.0）
 * salon-absence-system の line_utils.py 相当をTypeScriptで実装
 */

import crypto from 'crypto';

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
 * LINE Push メッセージ送信（リトライ付き）
 */
export async function sendLinePush(
  lineUserId: string,
  messages: LineMessage[],
  maxRetries = 3
): Promise<boolean> {
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

      if (res.ok) return true;

      const errorText = await res.text().catch(() => '');
      console.error(`[LINE] Push failed: ${res.status} ${errorText}`);

      // 4xx（429除く）は無効な user_id / 不正メッセージ等の恒久エラー。リトライしても解決せず
      // LINE API へ無駄なリクエストを連打するだけなので即座に false を返す。
      // 429(レート制限) と 5xx(一時障害) は下のバックオフでリトライする。
      // （res.ok=false を通過後のため status は非2xx/3xx。< 500 かつ 429 でなければ 4xx 恒久エラー）
      if (res.status < 500 && res.status !== 429) {
        return false;
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
  return false;
}

/**
 * テキストメッセージ送信（簡易版）
 */
export async function sendLineText(lineUserId: string, text: string): Promise<boolean> {
  return sendLinePush(lineUserId, [{ type: 'text', text }]);
}

/**
 * 予約確認通知を送信
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
  return sendLineText(lineUserId, text);
}

/**
 * 予約キャンセル通知を送信
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
  return sendLineText(lineUserId, text);
}

/**
 * 予約リマインド通知を送信
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
): Promise<boolean> {
  const staffLine = booking.staffName ? `\n担当: ${booking.staffName}` : '';
  const days = booking.daysBefore ?? 1;
  const when = days === 1 ? '明日' : `${days}日後`;
  const text = `🔔 ${when}のご予約リマインド\n\n📍 ${booking.facilityName}\n📋 ${booking.menuName}\n📅 ${booking.date} ${booking.time}${staffLine}\n\nお気をつけてお越しください。`;
  return sendLineText(lineUserId, text);
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
