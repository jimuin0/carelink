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

import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';

const LINE_WORKS_API_BASE = 'https://www.worksapis.com/v1.0';
const LINE_WORKS_AUTH_URL = 'https://auth.worksmobile.com/oauth2/v2.0/token';

type LineWorksTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

// アクセストークンのモジュールスコープキャッシュ。LINE Works のトークンは通常24時間有効だが、
// 旧実装は送信のたびに JWT 署名 + トークン取得 fetch を行っていた。有効期限内は再利用する。
let cachedToken: { value: string; expiresAt: number } | null = null;
// 期限ギリギリの使用を避けるための安全マージン（この時間だけ早く失効扱いにして再取得する）。
const TOKEN_CACHE_SAFETY_MS = 60_000;

/** テスト専用: トークンキャッシュをリセットする（モジュールスコープ状態の分離用）。 */
export function __resetLineWorksTokenCacheForTest(): void {
  cachedToken = null;
}

/**
 * LINE Works アクセストークンを取得（JWT Bearer Flow）。有効期限内はキャッシュを再利用する。
 */
export async function getLineWorksToken(forceRefresh = false): Promise<string | null> {
  const clientId = process.env.LINE_WORKS_CLIENT_ID;
  const clientSecret = process.env.LINE_WORKS_CLIENT_SECRET;
  const serviceAccount = process.env.LINE_WORKS_SERVICE_ACCOUNT;

  if (!clientId || !clientSecret || !serviceAccount) {
    return null;
  }

  // 有効なキャッシュがあれば JWT 署名・トークン取得を省略して再利用する。
  // forceRefresh 時は（サーバ側で失効した等でキャッシュが有効期限内でも無効な場合）キャッシュを
  // 無視して必ず再取得する。
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - TOKEN_CACHE_SAFETY_MS > Date.now()) {
    return cachedToken.value;
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
      // 監査X5: 他の外部fetch(gbp/line/hpb)と同様にタイムアウトを付与。
      // 未設定だとハング時に呼び出し元(予約API/cron)をVercel強制killまでブロックする。
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data: LineWorksTokenResponse = await res.json();
    cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 0) * 1000 };
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
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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

  const doSend = (bearer: string) => fetch(
    `${LINE_WORKS_API_BASE}/bots/${botId}/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
      // 監査X5: 送信fetchにもタイムアウトを付与（トークン取得側と対称）。
      signal: AbortSignal.timeout(10000),
    }
  );

  try {
    const res = await doSend(token);
    if (res.ok) return true;

    // 401/403 = トークンが（有効期限内でも）サーバ側で失効/無効化された可能性。
    // キャッシュを握ったままだと最大24時間（有効期限まで）全通知が無音で失敗し続けるため、
    // キャッシュを破棄して1度だけ強制再取得し再送する（発症前予防・恒久 miss の回避）。
    if (res.status === 401 || res.status === 403) {
      console.error('[line-works] send rejected (auth) — refreshing token and retrying', { status: res.status });
      cachedToken = null;
      const fresh = await getLineWorksToken(true);
      if (!fresh) {
        const err = new Error(`LINE Works send failed: token refresh unavailable after ${res.status}`);
        safeCaptureException(err, 'line-works-send');
        alertCaughtError('line-works-send', err, `line-works:channel:${channelId}`);
        return false;
      }
      const retry = await doSend(fresh);
      if (!retry.ok) {
        const err = new Error(`LINE Works send failed after token refresh: ${retry.status}`);
        safeCaptureException(err, 'line-works-send');
        alertCaughtError('line-works-send', err, `line-works:channel:${channelId}`);
      }
      return retry.ok;
    }

    // 呼び出し元は Promise<boolean> しか見ておらず throw しないため、ここで可視化しないと
    // チャンネル不正/Bot未参加/API障害等の失敗が完全無音になる（既知の未検出インシデントの原因）。
    const errorText = await res.text().catch(() => '');
    const err = new Error(`LINE Works send failed: ${res.status} ${errorText}`);
    safeCaptureException(err, 'line-works-send');
    alertCaughtError('line-works-send', err, `line-works:channel:${channelId}`);
    return false;
  } catch (e) {
    safeCaptureException(e, 'line-works-send');
    alertCaughtError('line-works-send', e, `line-works:channel:${channelId}`);
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
