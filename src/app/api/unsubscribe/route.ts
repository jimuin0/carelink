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

    // D-4: 対応する profiles があれば user_id を紐付ける（監査・以後の判定で有用。取得できない
    // アドレス（アカウント未登録のオーナー等）は null のまま）。
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();
    const linkedUserId = (profileRow as { id: string } | null)?.id ?? null;

    // already 判定（UI 表示用）。この読みの TOCTOU は表示メッセージのみに影響し無害。
    const { data: sub } = await supabase
      .from('newsletter_subscriptions')
      .select('id, is_active')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (sub?.is_active === false) {
      return NextResponse.json({ success: true, already: true });
    }

    const unsubbedAt = new Date().toISOString();
    const row = {
      email: normalizedEmail,
      subscription_type: 'all',
      is_active: false,
      unsubscribed_at: unsubbedAt,
      source: 'unsubscribe',
      user_id: linkedUserId,
    };

    // D-3: 書き込みは email を衝突キーにした upsert で原子的に行い、並行解除で重複 inactive 行が
    // できる TOCTOU を塞ぐ。email に UNIQUE 制約がある前提。制約未適用（migration 前）は onConflict が
    // 42P10 で失敗するため、従来の update/insert 分岐へフォールバックする（deploy 順序非依存）。
    const up = await supabase
      .from('newsletter_subscriptions')
      .upsert(row, { onConflict: 'email' });

    if (up.error) {
      const missingConstraint =
        up.error.code === '42P10' || /no unique or exclusion constraint/i.test(up.error.message ?? '');
      if (!missingConstraint) {
        console.error('[unsubscribe] newsletter_subscriptions upsert failed', { err: up.error });
        return NextResponse.json({ error: '配信停止の処理に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
      }
      // フォールバック（UNIQUE 未適用）: 既存行があれば update、無ければ insert。
      if (sub) {
        const { error: unsubErr } = await supabase
          .from('newsletter_subscriptions')
          .update({ is_active: false, unsubscribed_at: unsubbedAt, user_id: linkedUserId })
          .eq('id', sub.id);
        if (unsubErr) {
          console.error('[unsubscribe] newsletter_subscriptions update failed', { err: unsubErr });
          return NextResponse.json({ error: '配信停止の処理に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
        }
      } else {
        const { error: insertErr } = await supabase
          .from('newsletter_subscriptions')
          .insert(row);
        if (insertErr) {
          console.error('[unsubscribe] newsletter_subscriptions insert failed', { err: insertErr });
          return NextResponse.json({ error: '配信停止の処理に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
        }
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
