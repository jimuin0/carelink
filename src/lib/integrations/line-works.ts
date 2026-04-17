/**
 * LINE Works連携: 施設スタッフへの通知
 * LINE Works Bot API v2.0 を使用
 *
 * 必要な環境変数:
 * - LINE_WORKS_CLIENT_ID: LINE Works OAuth2 クライアントID
 * - LINE_WORKS_CLIENT_SECRET: LINE Works OAuth2 クライアントシークレット
 * - LINE_WORKS_SERVICE_ACCOUNT: サービスアカウントID
 * - LINE_WORKS_PRIVATE_KEY: RSA秘密鍵（PEM形式）
 * - LINE_WORKS_BOT_ID: Bot ID
 */

const LINE_WORKS_API_BASE = 'https://www.worksapis.com/v1.0';
const LINE_WORKS_AUTH_URL = 'https://auth.worksmobile.com/oauth2/v2.0/token';

type LineWorksTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

/**
 * LINE Works アクセストークンを取得（JWT Bearer Flow）
 */
export async function getLineWorksToken(): Promise<string | null> {
  const clientId = process.env.LINE_WORKS_CLIENT_ID;
  const clientSecret = process.env.LINE_WORKS_CLIENT_SECRET;
  const serviceAccount = process.env.LINE_WORKS_SERVICE_ACCOUNT;

  if (!clientId || !clientSecret || !serviceAccount) {
    return null;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: clientId,
      client_secret: clientSecret,
      assertion: await buildJwt(clientId, serviceAccount),
      scope: 'bot',
    });

    const res = await fetch(LINE_WORKS_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) return null;
    const data: LineWorksTokenResponse = await res.json();
    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * JWT生成 (RS256)
 * NOTE: In production use a proper JWT library (jose/jsonwebtoken)
 */
/** Base64URL encoding (JWT requires URL-safe Base64 without padding) */
function base64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlUint8(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function buildJwt(clientId: string, serviceAccount: string): Promise<string> {
  const privateKeyPem = process.env.LINE_WORKS_PRIVATE_KEY;
  if (!privateKeyPem) throw new Error('LINE_WORKS_PRIVATE_KEY not set');

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    iss: clientId,
    sub: serviceAccount,
    iat: now,
    exp: now + 3600,
  }));

  // Web Crypto API for RSA-SHA256 signing
  const pemContents = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const data = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, data);
  const sigB64url = base64urlUint8(new Uint8Array(signature));

  return `${header}.${payload}.${sigB64url}`;
}

type LineWorksMessage = {
  content: {
    type: 'text' | 'flex';
    text?: string;
    altText?: string;
    contents?: object;
  };
};

/**
 * LINE Worksチャンネルにメッセージ送信
 * @param channelId LINE Works チャンネルID
 * @param message 送信するメッセージ
 */
export async function sendLineWorksMessage(
  channelId: string,
  message: LineWorksMessage
): Promise<boolean> {
  const botId = process.env.LINE_WORKS_BOT_ID;
  if (!botId) return false;

  const token = await getLineWorksToken();
  if (!token) return false;

  try {
    const res = await fetch(
      `${LINE_WORKS_API_BASE}/bots/${botId}/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 新規予約通知をLINE Worksに送信
 * @param channelId スタッフのLINE Worksチャンネル
 * @param booking 予約情報
 */
export async function notifyNewBookingLineWorks(
  channelId: string,
  booking: {
    customerName: string;
    menuName: string;
    bookingDate: string;
    startTime: string;
    staffName?: string;
  }
): Promise<boolean> {
  const message: LineWorksMessage = {
    content: {
      type: 'text',
      text: [
        '📅 新規予約が入りました',
        '',
        `お客様: ${booking.customerName}`,
        `メニュー: ${booking.menuName}`,
        `日時: ${booking.bookingDate} ${booking.startTime}`,
        ...(booking.staffName ? [`担当: ${booking.staffName}`] : []),
        '',
        '管理画面で詳細を確認してください',
      ].join('\n'),
    },
  };

  return sendLineWorksMessage(channelId, message);
}

/**
 * キャンセル通知をLINE Worksに送信
 */
export async function notifyCancellationLineWorks(
  channelId: string,
  booking: {
    customerName: string;
    menuName: string;
    bookingDate: string;
    startTime: string;
  }
): Promise<boolean> {
  const message: LineWorksMessage = {
    content: {
      type: 'text',
      text: [
        '❌ 予約キャンセル',
        '',
        `お客様: ${booking.customerName}`,
        `メニュー: ${booking.menuName}`,
        `日時: ${booking.bookingDate} ${booking.startTime}`,
        '',
        '枠が空きになりました',
      ].join('\n'),
    },
  };

  return sendLineWorksMessage(channelId, message);
}

export function isLineWorksConfigured(): boolean {
  return !!(
    process.env.LINE_WORKS_CLIENT_ID &&
    process.env.LINE_WORKS_CLIENT_SECRET &&
    process.env.LINE_WORKS_SERVICE_ACCOUNT &&
    process.env.LINE_WORKS_BOT_ID
  );
}
