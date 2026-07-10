/**
 * Google reCAPTCHA v3 検証ヘルパー（v8.35）
 * 予約・レビュー投稿フォームのBot対策として使用
 *
 * 環境変数:
 *   NEXT_PUBLIC_RECAPTCHA_SITE_KEY  - フロントエンド用（v3 サイトキー）
 *   RECAPTCHA_SECRET_KEY            - サーバー検証用
 */

import { postAlert } from '@/lib/alert';

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
    // キーが未設定の場合はスキップ（開発環境対応）。fail-open/fail-closed のどちらにするかは
    // 意図的な既存設計（ネットワーク障害時は fail-closed・secret未設定時のみ fail-open）で、
    // このヘルパーでは変更しない（可用性とのトレードオフのため）。
    // 【2026年7月10日 恒久根治】本番で未設定の場合、従来は console.warn のみで誰も気づけず
    // Bot対策が無音で無効化されたままになり得た（email.ts の EMAIL_FROM 不正値と同型の
    // 「無音の設定ミス」問題）。postAlert で Slack に必ず可視化する。
    if (process.env.NODE_ENV === 'production') {
      const msg = `RECAPTCHA_SECRET_KEY が未設定のため reCAPTCHA 検証を全てスキップしています（Bot対策が無効化された状態です）。action=${action}`;
      console.warn('[recaptcha:secret-missing]', msg);
      postAlert({ level: 'error', message: msg, route: 'recaptcha:secret-missing', env: process.env.VERCEL_ENV });
    }
    return { success: true, reason: 'no_secret_key' };
  }

  try {
    const res = await fetch(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secretKey, response: token }),
      // Google siteverify が応答しない場合に予約フォームが無限待機するのを防ぐ。
      // タイムアウト時は AbortError が throw され下の catch で fail-closed（verify_error）に倒れる。
      // AbortSignal.timeout は Node で unref 済みのためタイマーリークも起こさない。
      signal: AbortSignal.timeout(10_000),
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
