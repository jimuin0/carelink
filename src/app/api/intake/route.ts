/**
 * 問診票 API（v8.36）
 * GET /api/intake?facility_id=xxx    - テンプレート取得
 * POST /api/intake                   - 回答送信
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'intake-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get('facility_id');
  if (!facilityId) return NextResponse.json({ error: 'facility_id が必要です' }, { status: 400 });
  if (!UUID_REGEX.test(facilityId)) return NextResponse.json({ error: 'Invalid facility_id' }, { status: 400 });

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: template } = await supabase
    .from('intake_form_templates')
    .select('id, title, description, fields')
    .eq('facility_id', facilityId)
    .eq('is_active', true)
    .maybeSingle();

  if (!template) {
    return NextResponse.json({ template: null });
  }

  return NextResponse.json({ template });
}

export async function POST(request: Request) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 5, 60_000, 'intake')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const cookieStore = await cookies();
  // 認証判定のみ anon SSR クライアント（cookie からセッション解決）。
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  // DB 書き込み・参照は service_role に集約（anon INSERT ポリシー削除後も継続動作）。
  // anon キー直書き込み（guest 偽装スパム・医療系 PII 注入）を物理的に不能化する恒久対策。
  const supabase = createServiceRoleClient();

  const body = await request.json().catch(() => null);
  if (!body?.template_id || !body?.customer_name || !body?.facility_id) {
    return NextResponse.json({ error: '必須フィールドが不足しています' }, { status: 400 });
  }
  if (!UUID_REGEX.test(body.template_id)) return NextResponse.json({ error: 'Invalid template_id' }, { status: 400 });
  if (!UUID_REGEX.test(body.facility_id)) return NextResponse.json({ error: 'Invalid facility_id' }, { status: 400 });
  if (body.booking_id && !UUID_REGEX.test(body.booking_id)) return NextResponse.json({ error: 'Invalid booking_id' }, { status: 400 });

  const responsesJson = body.responses ?? {};
  const responsesStr = JSON.stringify(responsesJson);
  if (responsesStr.length > 50_000) return NextResponse.json({ error: 'responses too large' }, { status: 400 });

  const { data: { user } } = await authClient.auth.getUser();

  // booking_id が指定された場合、その予約が認証ユーザー本人のものであることを確認（IDOR防止）
  if (body.booking_id) {
    if (!user) {
      return NextResponse.json({ error: '予約IDを指定する場合は認証が必要です' }, { status: 401 });
    }
    const { data: booking } = await supabase
      .from('bookings')
      .select('id')
      .eq('id', body.booking_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!booking) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 403 });
    }
  }

  const { data: response, error } = await supabase
    .from('intake_form_responses')
    .insert({
      template_id:   body.template_id,
      facility_id:   body.facility_id,
      booking_id:    body.booking_id ?? null,
      user_id:       user?.id ?? null,
      customer_name: String(body.customer_name).slice(0, 50),
      responses:     responsesJson,
    })
    .select('id')
    .single();

  if (error || !response) {
    return NextResponse.json({ error: '送信に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: response.id });
}
