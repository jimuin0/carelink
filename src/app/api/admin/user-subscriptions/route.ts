import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const grantSchema = z.object({
  facility_id: z.string().uuid(),
  user_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  notes: z.string().max(200).optional(),
});

const useSchema = z.object({
  subscription_id: z.string().uuid(),
  booking_id: z.string().uuid().optional(),
  notes: z.string().max(200).optional(),
});

const updateStatusSchema = z.object({
  subscription_id: z.string().uuid(),
  status: z.enum(['active', 'cancelled', 'paused', 'expired']),
});

async function checkAdminMembership(supabase: ReturnType<typeof createServerSupabaseAuthClient>, userId: string, facilityId: string) {
  const { data } = await supabase
    .from('facility_members')
    .select('role')
    .eq('user_id', userId)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();
  return !!data;
}

export async function GET(request: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!facilityId) return NextResponse.json({ error: 'facility_id required' }, { status: 400 });

  const isAdmin = await checkAdminMembership(supabase, user.id, facilityId);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let query = admin
    .from('user_subscriptions')
    .select('*, subscription_plans(name, price, sessions_per_month), profiles(display_name, email)')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false });

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query.limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ subscriptions: data });
}

// 管理者がユーザーにサブスクを付与
export async function POST(request: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const isAdmin = await checkAdminMembership(supabase, user.id, parsed.data.facility_id);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: plan } = await admin.from('subscription_plans')
    .select('valid_months')
    .eq('id', parsed.data.plan_id)
    .eq('facility_id', parsed.data.facility_id)
    .single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const endsAt = new Date();
  endsAt.setMonth(endsAt.getMonth() + plan.valid_months);

  const { data, error } = await admin.from('user_subscriptions').insert({
    user_id: parsed.data.user_id,
    facility_id: parsed.data.facility_id,
    plan_id: parsed.data.plan_id,
    ends_at: endsAt.toISOString(),
    notes: parsed.data.notes,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ subscription: data }, { status: 201 });
}

// 1回セッション使用
export async function PATCH(request: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);

  // ステータス変更
  const statusParsed = updateStatusSchema.safeParse(body);
  if (statusParsed.success && body.status) {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: sub } = await admin.from('user_subscriptions').select('facility_id').eq('id', statusParsed.data.subscription_id).single();
    if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const isAdmin = await checkAdminMembership(supabase, user.id, sub.facility_id);
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await admin.from('user_subscriptions')
      .update({ status: statusParsed.data.status })
      .eq('id', statusParsed.data.subscription_id)
      .select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ subscription: data });
  }

  // セッション使用
  const useParsed = useSchema.safeParse(body);
  if (!useParsed.success) return NextResponse.json({ error: useParsed.error.issues[0].message }, { status: 400 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: sub } = await admin
    .from('user_subscriptions')
    .select('*, subscription_plans(sessions_per_month, facility_id)')
    .eq('id', useParsed.data.subscription_id)
    .single();

  if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const facilityId = (sub.subscription_plans as { facility_id: string } | null)?.facility_id;
  const isAdminUser = facilityId ? await checkAdminMembership(supabase, user.id, facilityId) : false;
  const isOwner = sub.user_id === user.id;
  if (!isOwner && !isAdminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (sub.status !== 'active') return NextResponse.json({ error: 'サブスクリプションが有効ではありません' }, { status: 400 });
  if (sub.ends_at && new Date(sub.ends_at) < new Date()) return NextResponse.json({ error: '有効期限が切れています' }, { status: 400 });

  // 月リセット確認
  const now = new Date();
  const resetAt = new Date(sub.month_reset_at);
  let usedThisMonth = sub.sessions_used_this_month;
  if (now >= resetAt) {
    usedThisMonth = 0;
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await admin.from('user_subscriptions').update({ sessions_used_this_month: 0, month_reset_at: nextReset.toISOString() }).eq('id', sub.id);
  }

  const sessionsPerMonth = (sub.subscription_plans as { sessions_per_month: number } | null)?.sessions_per_month ?? 4;
  if (usedThisMonth >= sessionsPerMonth) {
    return NextResponse.json({ error: `今月の利用回数上限（${sessionsPerMonth}回）に達しています` }, { status: 400 });
  }

  const { data: updated, error } = await admin
    .from('user_subscriptions')
    .update({ sessions_used_this_month: usedThisMonth + 1 })
    .eq('id', useParsed.data.subscription_id)
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from('subscription_usage_logs').insert({
    subscription_id: useParsed.data.subscription_id,
    booking_id: useParsed.data.booking_id ?? null,
    notes: useParsed.data.notes,
  });

  return NextResponse.json({ subscription: updated });
}
