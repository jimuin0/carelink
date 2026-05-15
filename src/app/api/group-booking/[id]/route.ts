/**
 * グループ予約 詳細・更新
 * GET    /api/group-booking/[id]
 * PATCH  /api/group-booking/[id] — ステータス更新
 * DELETE /api/group-booking/[id] — キャンセル
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'group-booking-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  const { data: group } = await admin
    .from('group_bookings')
    .select('*, facility_profiles(name, slug, phone), group_booking_members(*)')
    .eq('id', params.id)
    .single();

  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Must be organizer or member
  const isMember = (group.group_booking_members as { user_id: string }[]).some((m) => m.user_id === user.id);
  if (group.organizer_id !== user.id && !isMember) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  return NextResponse.json(group);
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'group-booking-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  const { data: group } = await admin.from('group_bookings').select('organizer_id').eq('id', params.id).single();
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (group.organizer_id !== user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const allowed: Record<string, unknown> = {};
  if (body.status && ['confirmed', 'cancelled', 'completed'].includes(body.status)) allowed.status = body.status;
  if (body.notes !== undefined) allowed.notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null;

  const { data, error } = await admin.from('group_bookings').update(allowed).eq('id', params.id).select().single();
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'group-booking-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  const { data: group } = await admin.from('group_bookings').select('organizer_id').eq('id', params.id).single();
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (group.organizer_id !== user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { error: cancelErr } = await admin.from('group_bookings').update({ status: 'cancelled' }).eq('id', params.id).eq('organizer_id', user.id);
  if (cancelErr) return NextResponse.json({ error: 'キャンセルに失敗しました' }, { status: 500 });
  return NextResponse.json({ success: true });
}
