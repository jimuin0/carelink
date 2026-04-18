/**
 * メール配信停止 API（v8.17）
 * POST /api/unsubscribe
 * トークンを検証してprofilesのemail_unsubscribedをtrueに設定する
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { inMemoryRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  token: z.string().length(64).regex(/^[0-9a-f]+$/),
});

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'unsubscribe')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'トークンが不正です' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  // トークン検索（未使用のもののみ）
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('email_unsubscribe_tokens')
    .select('user_id, used_at')
    .eq('token', parsed.data.token)
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
    // プロフィールが既に停止済み → トークンも使用済みにマーク
    await supabase
      .from('email_unsubscribe_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', parsed.data.token);
    return NextResponse.json({ success: true, already: true });
  }

  // 配信停止フラグをセット
  await supabase
    .from('profiles')
    .update({ email_unsubscribed: true })
    .eq('id', tokenRow.user_id);

  // トークンを使用済みにマーク
  await supabase
    .from('email_unsubscribe_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', parsed.data.token);

  return NextResponse.json({ success: true, already: false });
}
