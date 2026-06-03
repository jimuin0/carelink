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

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'crypto';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { checkCsrf } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

const tokenSchema = z.object({
  token: z.string().length(64).regex(/^[0-9a-f]+$/),
});

const hmacSchema = z.object({
  email: z.string().email().max(254),
  hmac: z.string().length(64).regex(/^[0-9a-f]+$/),
});

function verifyUnsubHmac(email: string, hmac: string): boolean {
  const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(email.toLowerCase()).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (inMemoryRateLimit(ip, 10, 60_000, 'unsubscribe')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  // 方式B: HMAC ベースのニュースレター配信停止
  const hmacParsed = hmacSchema.safeParse(body);
  if (hmacParsed.success) {
    const { email, hmac } = hmacParsed.data;
    if (!verifyUnsubHmac(email, hmac)) {
      // HMACが不正でも成功扱い（列挙攻撃防止）
      return NextResponse.json({ success: true, already: true });
    }

    const normalizedEmail = email.toLowerCase();

    // newsletter_subscriptions を非アクティブ化
    const { data: sub } = await supabase
      .from('newsletter_subscriptions')
      .select('is_active')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (sub?.is_active === false) {
      return NextResponse.json({ success: true, already: true });
    }

    const { error: unsubErr } = await supabase
      .from('newsletter_subscriptions')
      .update({ is_active: false })
      .eq('email', normalizedEmail);
    if (unsubErr) {
      console.error('[unsubscribe] newsletter_subscriptions update failed', { err: unsubErr });
      return NextResponse.json({ error: '配信停止の処理に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
    }

    // profiles に一致するアカウントがあれば email_unsubscribed もセット
    const { error: profileUnsubErr } = await supabase
      .from('profiles')
      .update({ email_unsubscribed: true })
      .eq('email', normalizedEmail);
    if (profileUnsubErr) console.error('[unsubscribe] profiles email_unsubscribed update failed', { err: profileUnsubErr });

    return NextResponse.json({ success: true, already: false });
  }

  // 方式A: DB トークンベース
  const tokenParsed = tokenSchema.safeParse(body);
  if (!tokenParsed.success) {
    return NextResponse.json({ error: 'トークンが不正です' }, { status: 400 });
  }

  // トークン検索（未使用のもののみ）
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('email_unsubscribe_tokens')
    .select('user_id, used_at')
    .eq('token', tokenParsed.data.token)
    .single();

  if (tokenErr || !tokenRow) {
    // トークン不明 → 成功扱い（列挙攻撃防止）
    return NextResponse.json({ success: true, already: true });
  }

  // 使用済みトークンの再利用を拒否（idempotent: already=true で返す）
  if (tokenRow.used_at !== null) {
    return NextResponse.json({ success: true, already: true });
  }

  // profiles のフラグを確認（既に停止済みか）
  const { data: profile } = await supabase
    .from('profiles')
    .select('email_unsubscribed')
    .eq('id', tokenRow.user_id)
    .single();

  if (profile?.email_unsubscribed) {
    await supabase
      .from('email_unsubscribe_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', tokenParsed.data.token);
    return NextResponse.json({ success: true, already: true });
  }

  // 配信停止フラグをセット
  const { error: profileFlagErr } = await supabase
    .from('profiles')
    .update({ email_unsubscribed: true })
    .eq('id', tokenRow.user_id);
  if (profileFlagErr) {
    console.error('[unsubscribe] profile flag update failed', { userId: tokenRow.user_id, err: profileFlagErr });
    return NextResponse.json({ error: '配信停止の処理に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
  }

  // トークンを使用済みにマーク
  const { error: tokenMarkErr } = await supabase
    .from('email_unsubscribe_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', tokenParsed.data.token);
  if (tokenMarkErr) console.error('[unsubscribe] token mark-used failed — token may be reused', { err: tokenMarkErr });

  return NextResponse.json({ success: true, already: false });
}
