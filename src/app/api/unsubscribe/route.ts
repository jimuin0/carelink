/**
 * メール配信停止 API
 * POST /api/unsubscribe
 *
 * 方式A（既存: アカウント登録ユーザー向け）:
 *   { token: "<64-char hex>" }  — email_unsubscribe_tokens テーブルで検索
 *
 * 方式B（ニュースレター向け）:
 *   { email: "...", hmac: "<64-char hex>" }  — HMAC-SHA256 で検証（ステートレス）
 */

import { createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'crypto';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { checkCsrf } from '@/lib/csrf';
import { decryptUnsubEmail } from '@/lib/newsletter-unsub';
import { serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

const tokenSchema = z.object({
  token: z.string().length(64).regex(/^[0-9a-f]+$/),
});

const hmacSchema = z.object({
  email: z.string().email().max(254),
  hmac: z.string().length(64).regex(/^[0-9a-f]+$/),
});

// 方式C: 暗号化トークン（メールを URL に露出しない不透明トークン）。サーバだけが復号できる。
const tokenEncSchema = z.object({
  n: z.string().min(1).max(512),
});

function verifyUnsubHmac(email: string, hmac: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(email.toLowerCase()).digest('hex');
  // The validated request contains 64 hex digits; SHA-256 also produces 32
  // bytes. Unexpected crypto failures must reach the API dependency error.
  return timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
}

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
    if (await checkRateLimit(null, ip, 10, 60_000, 'unsubscribe')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }

    const body = await request.json().catch(() => null);

    const supabase = createServiceRoleClient();
    const applySuppression = async (email: string | null, token: string | null): Promise<NextResponse> => {
      type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
      const result = await (supabase.rpc as unknown as Rpc)('unsubscribe_newsletter_atomic', { p_email: email, p_token: token });
      if (result.error !== null) return serverError('unsubscribe-atomic', result.error, '/api/unsubscribe', '配信停止の処理を確認できません。時間をおいて再度お試しください。');
      const parsed = z.object({ success: z.literal(true), already: z.boolean() }).strict().safeParse(result.data);
      if (!parsed.success) return serverError('unsubscribe-atomic-receipt', new Error('Invalid unsubscribe receipt'), '/api/unsubscribe', '配信停止の結果を確認できません。再度お試しください。');
      return NextResponse.json(parsed.data);
    };

    // 方式C: 暗号化トークン（推奨・メールを URL に露出しない）。サーバで復号して停止する。
    const encParsed = tokenEncSchema.safeParse(body);
    if (encParsed.success) {
      if (!process.env.NEWSLETTER_UNSUBSCRIBE_SECRET) return NextResponse.json({ error: '配信停止の設定を確認できません。時間をおいて再度お試しください。' }, { status: 503 });
      const email = decryptUnsubEmail(encParsed.data.n);
      // 復号失敗（不正/改ざん/鍵不一致）は成功扱い（列挙攻撃防止）。
      if (!email) {
        return NextResponse.json({ success: true, already: true });
      }
      return await applySuppression(email, null);
    }

    // 方式B: HMAC ベースのニュースレター配信停止（既送信メールの後方互換）
    const hmacParsed = hmacSchema.safeParse(body);
    if (hmacParsed.success) {
      const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
      if (!secret) return NextResponse.json({ error: '配信停止の設定を確認できません。時間をおいて再度お試しください。' }, { status: 503 });
      const { email, hmac } = hmacParsed.data;
      if (!verifyUnsubHmac(email, hmac, secret)) {
        // HMACが不正でも成功扱い（列挙攻撃防止）
        return NextResponse.json({ success: true, already: true });
      }
      return await applySuppression(email, null);
    }

    // 方式A: DB トークンベース
    const tokenParsed = tokenSchema.safeParse(body);
    if (!tokenParsed.success) {
      return NextResponse.json({ error: 'トークンが不正です' }, { status: 400 });
    }

    return await applySuppression(null, tokenParsed.data.token);
  } catch (e) {
    return serverError('unsubscribe', e, '/api/unsubscribe');
  }
}
