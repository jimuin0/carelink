/**
 * LINE Messaging API ユーティリティ（v8.0）
 * salon-absence-system の line_utils.py 相当をTypeScriptで実装
 */

import crypto from 'crypto';

const LINE_API_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

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
  }
): Promise<boolean> {
  const staffLine = booking.staffName ? `\n担当: ${booking.staffName}` : '';
  const text = `🔔 明日のご予約リマインド\n\n📍 ${booking.facilityName}\n📋 ${booking.menuName}\n📅 ${booking.date} ${booking.time}${staffLine}\n\nお気をつけてお越しください。`;
  return sendLineText(lineUserId, text);
}

/**
 * LINE Webhook 署名検証
 */
export function verifyLineSignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET_CARELINK;
  if (!secret) throw new Error('LINE_CHANNEL_SECRET_CARELINK is not set');

  const hash = crypto
    .createHmac('SHA256', secret)
    .update(body)
    .digest('base64');

  return hash === signature;
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
