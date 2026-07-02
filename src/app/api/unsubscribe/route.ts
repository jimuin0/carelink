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
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { checkCsrf } from '@/lib/csrf';
import { decryptUnsubEmail } from '@/lib/newsletter-unsub';

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
  if (await checkRateLimit(null, ip, 10, 60_000, 'unsubscribe')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  // メール起点の配信停止（方式B / 方式C 共通）。newsletter_subscriptions と profiles を停止する。
  const unsubscribeByEmail = async (email: string): Promise<NextResponse> => {
    const normalizedEmail = email.toLowerCase();

    // newsletter_subscriptions を非アクティブ化。既存行があれば update、無ければ insert する
    // （UNIQUE制約が email/user_id に無いテーブルのため upsert は使えず select→分岐で行う）。
    // 旧実装は update のみで、購読レコードを持たないアドレス（例: facility_members からのみ
    // 宛先化される owner_monthly のオーナー）は 0 行更新となり停止行が一切作られず、
    // newsletter_subscriptions ベースの判定では永久に配信停止できなかった（実送信 API の
    // フィルタが profiles.email_unsubscribed も必ず見るよう別途対策済みだが、購読テーブル側の
    // 記録も一貫させ、どちらの判定経路でも確実に止まるようにする＝多層防御）。
    const { data: sub } = await supabase
      .from('newsletter_subscriptions')
      .select('id, is_active')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (sub?.is_active === false) {
      return NextResponse.json({ success: true, already: true });
    }

    if (sub) {
      const { error: unsubErr } = await supabase
        .from('newsletter_subscriptions')
        .update({ is_active: false, unsubscribed_at: new Date().toISOString() })
        .eq('id', sub.id);
      if (unsubErr) {
        console.error('[unsubscribe] newsletter_subscriptions update failed', { err: unsubErr });
        return NextResponse.json({ error: '配信停止の処理に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
      }
    } else {
      // 購読レコードが無いアドレス（オーナーのみ等）にも、以後の判定に使えるよう
      // 明示的に停止レコードを作成する（source='unsubscribe' で由来を残す）。
      const { error: insertErr } = await supabase
        .from('newsletter_subscriptions')
        .insert({
          email: normalizedEmail,
          subscription_type: 'all',
          is_active: false,
          unsubscribed_at: new Date().toISOString(),
          source: 'unsubscribe',
        });
      if (insertErr) {
        console.error('[unsubscribe] newsletter_subscriptions insert failed', { err: insertErr });
        return NextResponse.json({ error: '配信停止の処理に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
      }
    }

    // profiles に一致するアカウントがあれば email_unsubscribed もセット
    const { error: profileUnsubErr } = await supabase
      .from('profiles')
      .update({ email_unsubscribed: true })
      .eq('email', normalizedEmail);
    if (profileUnsubErr) console.error('[unsubscribe] profiles email_unsubscribed update failed', { err: profileUnsubErr });

    return NextResponse.json({ success: true, already: false });
  };

  // 方式C: 暗号化トークン（推奨・メールを URL に露出しない）。サーバで復号して停止する。
  const encParsed = tokenEncSchema.safeParse(body);
  if (encParsed.success) {
    const email = decryptUnsubEmail(encParsed.data.n);
    // 復号失敗（不正/改ざん/鍵不一致）は成功扱い（列挙攻撃防止）。
    if (!email) {
      return NextResponse.json({ success: true, already: true });
    }
    return unsubscribeByEmail(email);
  }

  // 方式B: HMAC ベースのニュースレター配信停止（既送信メールの後方互換）
  const hmacParsed = hmacSchema.safeParse(body);
  if (hmacParsed.success) {
    const { email, hmac } = hmacParsed.data;
    if (!verifyUnsubHmac(email, hmac)) {
      // HMACが不正でも成功扱い（列挙攻撃防止）
      return NextResponse.json({ success: true, already: true });
    }
    return unsubscribeByEmail(email);
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
