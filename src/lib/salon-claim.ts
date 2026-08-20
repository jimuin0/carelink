import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { UUID_REGEX } from '@/lib/constants';

/**
 * salons への「所有権 claim」を運ぶ HttpOnly Cookie の発行・検証（2026年8月20日 新設）。
 *
 * 【背景】/register の入力を /admin/onboarding が管理画面へ引き継ぐキーは、いまも
 * 「メールの一致（canonical）」だけ（src/app/api/facility/setup/route.ts）。salons.email は
 * 一度も検証されておらず、他人のメールアドレスで申し込むだけで別人の登録内容を横取りできる。
 *
 * salons.id を URL・メールリンクへ載せる案は敵対検証で却下済み（GA4/Clarity/Vercel Analytics・
 * signup の emailRedirectTo・アクセスログへ残るため）。本モジュールは POST /api/salons が
 * 成功した「その場のブラウザ」にだけ、salons.id を運ぶ署名付き HttpOnly Cookie を発行し、
 * /api/facility/setup がそれを最優先の引き継ぎ元として使う。Cookie は JS からも読めず、
 * URL・ログ・Referer のどこにも salons.id が露出しない。
 *
 * 【署名方式】src/middleware.ts の signCacheValue / verifyCacheValue を手本にする：
 * HMAC に発行時刻を含め、サーバー側で独立に期限判定する。Cookie の maxAge はブラウザ側の
 * 自己申告（検証不能）のため、盗まれた/使い回された Cookie 値をそのまま信用しない。
 *
 * 【鍵】新規 env を増やさず、既存の ADMIN_COOKIE_SECRET から sha256 で導出する
 * （src/lib/newsletter-unsub.ts の「既存 secret から sha256 導出」と同型の前例）。
 * ADMIN_COOKIE_SECRET は /admin membership キャッシュ用途と鍵素材を共有するため、
 * 生の secret をそのまま HMAC 鍵に使わず、用途ラベル付きで sha256 したものを鍵にする
 * （ドメイン分離＝一方の署名フォーマットが破られても、もう一方の偽造材料にはならない）。
 * 鍵が未設定の環境（ADMIN_COOKIE_SECRET 未設定）では発行も検証もしない（fail-safe）。
 * その場合、呼び出し側（facility/setup）は従来どおりメール一致にのみ倒れる。
 */

// 他の Cookie（_cm_mbr_* 等）と衝突しない名前。値には salons.id のみを載せる。
export const SALON_CLAIM_COOKIE_NAME = 'clnk_salon_claim';

// TTL: 数日程度（register → signup → onboarding の一連の操作を跨ぐには十分・
// 使われないまま長期間残ることは避ける）。
export const SALON_CLAIM_TTL_SECONDS = 60 * 60 * 24 * 3; // 3日

function claimKey(): string | null {
  const secret = process.env.ADMIN_COOKIE_SECRET;
  if (!secret) return null;
  return createHash('sha256').update(`salon-claim:${secret}`).digest('hex');
}

function computeSig(salonId: string, issuedAtEpochSec: number, key: string): string {
  return createHmac('sha256', key).update(`${salonId}:${issuedAtEpochSec}`).digest('hex');
}

/**
 * salons.id から署名付き Cookie 値を作る。ADMIN_COOKIE_SECRET 未設定なら null
 * （呼び出し側は Cookie を発行しない＝従来のメール一致のみに倒れる）。
 */
export function signSalonClaim(
  salonId: string,
  issuedAtEpochSec: number = Math.floor(Date.now() / 1000)
): string | null {
  const key = claimKey();
  if (!key) return null;
  const sig = computeSig(salonId, issuedAtEpochSec, key);
  return `${salonId}.${issuedAtEpochSec}.${sig}`;
}

/**
 * Cookie 値を検証し、正当なら salons.id を返す。以下はすべて null（キャッシュ/Cookie 不成立
 * 扱い）: 鍵未設定・形式不正・salonId が UUID でない・署名不一致・発行時刻から TTL 超過
 * （未来方向のクロックスキューも含む）。呼び出し側は null をメール一致へのフォールバック契機とする。
 */
export function verifySalonClaim(
  cookieVal: string,
  nowEpochSec: number = Math.floor(Date.now() / 1000)
): string | null {
  const key = claimKey();
  if (!key) return null;

  const parts = cookieVal.split('.');
  if (parts.length !== 3) return null;
  const [salonId, issuedAtRaw, sigHex] = parts;
  if (!UUID_REGEX.test(salonId)) return null;
  if (!/^\d+$/.test(issuedAtRaw)) return null;
  const issuedAtEpochSec = Number(issuedAtRaw);
  if (!Number.isSafeInteger(issuedAtEpochSec)) return null;
  // HMAC-SHA256 = 64 桁の16進文字列以外は不正（Buffer.from(..,'hex') は不正文字を黙って
  // 読み飛ばすため、timingSafeEqual に渡す前に形式を明示的に検証する）。
  if (!/^[0-9a-f]{64}$/i.test(sigHex)) return null;

  const expectedSig = computeSig(salonId, issuedAtEpochSec, key);
  const sigBuf = Buffer.from(sigHex, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  // 署名が正当でも、発行時刻から TTL を超過していれば期限切れ。maxAge はブラウザの自己申告で
  // 検証不能なため、ここで発行時刻から独立に判定する（未来方向のクロックスキューも不正扱い）。
  const ageSec = nowEpochSec - issuedAtEpochSec;
  if (ageSec < 0 || ageSec > SALON_CLAIM_TTL_SECONDS) return null;

  return salonId;
}
