import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * ニュースレター配信停止リンク用の「不透明・ステートレス」トークン。
 *
 * 旧実装は `/unsubscribe?email=<生メール>&hmac=<...>` で顧客メールを URL に平文で載せ、
 * carelink 自身のアクセスログ/ブラウザ履歴/Referer にメールアドレスが残っていた（PII 露出）。
 * ここではメールを AES-256-GCM で暗号化し、URL には復号鍵を持つサーバだけが解ける不透明な
 * トークンのみを載せる（DB スキーマ追加不要のステートレス方式）。GCM の認証タグで改ざんを検知し、
 * 復号失敗（不正/改ざん/鍵不一致）は null を返して列挙攻撃を防ぐ。
 *
 * 鍵は既存の NEWSLETTER_UNSUBSCRIBE_SECRET から sha256 で 32 バイト導出する（新規 env 不要）。
 */

function unsubKey(): Buffer {
  const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error('NEWSLETTER_UNSUBSCRIBE_SECRET is not set');
  return createHash('sha256').update(secret).digest();
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

const IV_LEN = 12;
const TAG_LEN = 16;

/** メールアドレスを不透明トークンに暗号化する（URL クエリ用・base64url）。 */
export function encryptUnsubEmail(email: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', unsubKey(), iv);
  const ct = Buffer.concat([cipher.update(email.toLowerCase(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return b64urlEncode(Buffer.concat([iv, ct, tag]));
}

/** トークンを復号してメールアドレスを返す。不正/改ざん/形式不一致は null。 */
export function decryptUnsubEmail(token: string): string | null {
  try {
    const raw = b64urlDecode(token);
    // iv(12) + tag(16) + 暗号文(>=1) 未満は不正。
    if (raw.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(raw.length - TAG_LEN);
    const ct = raw.subarray(IV_LEN, raw.length - TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', unsubKey(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}

/** 配信停止リンク（メールを URL に露出しない不透明トークン版）。手動送信/ダイジェスト cron 共通。 */
export function newsletterUnsubUrl(email: string): string {
  return `https://carelink-jp.com/unsubscribe?n=${encryptUnsubEmail(email)}`;
}
