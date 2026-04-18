/**
 * Google reCAPTCHA v3 検証ヘルパー（v8.35）
 * 予約・レビュー投稿フォームのBot対策として使用
 *
 * 環境変数:
 *   NEXT_PUBLIC_RECAPTCHA_SITE_KEY  - フロントエンド用（v3 サイトキー）
 *   RECAPTCHA_SECRET_KEY            - サーバー検証用
 */

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/**
 * サーバーサイドでreCAPTCHAトークンを検証する
 * @param token クライアントから送信されたトークン
 * @param action 期待するアクション名（例: 'booking', 'review'）
 * @param minScore 最小スコア（0.0〜1.0、デフォルト0.5）
 */
export async function verifyRecaptcha(
  token: string,
  action: string,
  minScore = 0.5
): Promise<{ success: boolean; score?: number; reason?: string }> {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  if (!secretKey) {
    // キーが未設定の場合はスキップ（開発環境対応）
    return { success: true, reason: 'no_secret_key' };
  }

  try {
    const res = await fetch(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secretKey, response: token }),
    });
    const data = await res.json() as {
      success: boolean;
      score: number;
      action: string;
      'error-codes'?: string[];
    };

    if (!data.success) {
      return { success: false, reason: data['error-codes']?.join(',') || 'failed' };
    }

    if (data.action !== action) {
      return { success: false, score: data.score, reason: `action_mismatch:${data.action}` };
    }

    if (data.score < minScore) {
      return { success: false, score: data.score, reason: `low_score:${data.score}` };
    }

    return { success: true, score: data.score };
  } catch {
    // ネットワーク障害時はfail-closed（攻撃者がネットワーク制御でreCAPTCHAを回避できないようにする）
    return { success: false, reason: 'verify_error' };
  }
}
