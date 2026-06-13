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
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'group-booking-get')) {
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
  type Member = {
    user_id: string | null;
    guest_name?: string | null;
    guest_email?: string | null;
    guest_phone?: string | null;
    [k: string]: unknown;
  };
  const members = (group.group_booking_members ?? []) as Member[];
  const isOrganizer = group.organizer_id === user.id;
  const isMember = members.some((m) => m.user_id === user.id);
  if (!isOrganizer && !isMember) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // 主催者のみ全ゲストの PII（氏名/メール/電話）を閲覧可。メンバーには他ゲストの PII を返さず、
  // 自分の行のみ保持する（グループ内 PII 漏洩の防止＝最小公開）。
  const safeMembers = isOrganizer
    ? members
    : members.map((m) =>
        m.user_id === user.id
          ? m
          : { ...m, guest_name: null, guest_email: null, guest_phone: null }
      );

  return NextResponse.json({ ...group, group_booking_members: safeMembers });
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'group-booking-patch')) {
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
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'group-booking-delete')) {
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
