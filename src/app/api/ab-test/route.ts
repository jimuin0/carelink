import { NextRequest, NextResponse } from 'next/server';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { checkCsrf } from '@/lib/csrf';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';

const schema = z.object({
  experiment_key: z.string().min(1).max(100),
  variant: z.enum(['control', 'treatment']),
  event_type: z.enum(['impression', 'conversion', 'click', 'booking']),
  // user_id は受け付けない — セッションから取得してIDOR/なりすましを防止
  session_id: z.string().max(100).optional(),
  page_path: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (inMemoryRateLimit(ip, 100, 60_000, 'ab-test')) {
    return NextResponse.json({ ok: true }); // サイレント無視
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: true }); // サイレント無視

  // user_id はセッションから取得（リクエストボディの値は使わない）
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  const admin = createServiceRoleClient();

  await admin.from('ab_test_events').insert({
    experiment_key: parsed.data.experiment_key,
    variant: parsed.data.variant,
    event_type: parsed.data.event_type,
    user_id: user?.id ?? null,
    session_id: parsed.data.session_id ?? null,
    page_path: parsed.data.page_path ?? null,
    metadata: parsed.data.metadata ?? {},
  });

  return NextResponse.json({ ok: true });
}

// A/Bテスト結果の取得（プラットフォーム管理者専用）
export async function GET(request: NextRequest) {
  const getIp = getClientIp(request);
  if (inMemoryRateLimit(getIp, 20, 60_000, 'ab-test-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('is_platform_admin').eq('id', user.id).single();
  if (!profile?.is_platform_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const key = request.nextUrl.searchParams.get('key');
  if (!key || key.length > 100) return NextResponse.json({ error: 'key required' }, { status: 400 });

  const admin = createServiceRoleClient();

  const { data } = await admin
    .from('ab_test_events')
    .select('variant, event_type')
    .eq('experiment_key', key);

  if (!data) return NextResponse.json({ results: null });

  const stats: Record<string, Record<string, number>> = { control: {}, treatment: {} };
  for (const event of data) {
    const v = stats[event.variant];
    if (v) v[event.event_type] = (v[event.event_type] ?? 0) + 1;
  }

  // コンバージョン率計算
  const getRate = (variant: 'control' | 'treatment') => {
    const impressions = stats[variant].impression ?? 0;
    const conversions = stats[variant].conversion ?? 0;
    return impressions > 0 ? Math.round((conversions / impressions) * 1000) / 10 : 0;
  };

  return NextResponse.json({
    experiment_key: key,
    control: { ...stats.control, conversion_rate: getRate('control') },
    treatment: { ...stats.treatment, conversion_rate: getRate('treatment') },
    lift: getRate('treatment') - getRate('control'),
  });
}
