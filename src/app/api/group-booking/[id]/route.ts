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

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  const { data: group } = await admin.from('group_bookings').select('organizer_id').eq('id', params.id).single();
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (group.organizer_id !== user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  await admin.from('group_bookings').update({ status: 'cancelled' }).eq('id', params.id);
  return NextResponse.json({ success: true });
}
