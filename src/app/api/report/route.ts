/**
 * 通報 API（v8.14）
 * POST /api/report
 * レビュー・施設・写真の不正報告を受け付ける
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const reportSchema = z.object({
  target_type: z.enum(['review', 'facility', 'photo']),
  target_id: z.string().uuid(),
  reason: z.enum(['spam', 'inappropriate', 'fake', 'offensive', 'other']),
  detail: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, 'report')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
  }

  const cookieStore = await cookies();
  // 認証判定のみ anon SSR クライアント（cookie からセッション解決）。
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await authClient.auth.getUser();

  // DB 書き込みは service_role に集約（anon INSERT ポリシー削除後も継続動作・RLS 依存排除）。
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('reports').insert({
    reporter_user_id: user?.id ?? null,
    reporter_ip: ip,
    target_type: parsed.data.target_type,
    target_id: parsed.data.target_id,
    reason: parsed.data.reason,
    detail: parsed.data.detail || null,
  });

  if (error) {
    // 重複通報
    if (error.code === '23505') {
      return NextResponse.json({ error: '既にこの内容を通報済みです' }, { status: 409 });
    }
    return NextResponse.json({ error: '通報に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
