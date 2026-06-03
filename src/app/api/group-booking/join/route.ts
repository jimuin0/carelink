/**
 * グループ予約参加 API
 * POST /api/group-booking/join
 * Body: { share_code: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { checkCsrf } from '@/lib/csrf';

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (inMemoryRateLimit(ip, 10, 60_000, 'group-booking-join')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const raw = typeof body.share_code === 'string' ? body.share_code.toUpperCase().trim() : null;
  const code = raw && raw.length <= 20 ? raw : null;
  if (!code) return NextResponse.json({ error: 'share_code required' }, { status: 400 });

  const admin = createServiceRoleClient();

  const { data: group } = await admin
    .from('group_bookings')
    .select('id, organizer_id, total_members, confirmed_members, status')
    .eq('share_code', code)
    .single();

  if (!group) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
  if (group.status === 'cancelled') return NextResponse.json({ error: 'この予約はキャンセルされました' }, { status: 410 });
  if (group.status === 'completed') return NextResponse.json({ error: 'この予約は終了しています' }, { status: 410 });

  // Check if already a member
  const { data: existing } = await admin
    .from('group_booking_members')
    .select('id, status')
    .eq('group_booking_id', group.id)
    .eq('user_id', user.id)
    .single();

  if (existing) {
    // Update status to confirmed if was invited
    if (existing.status === 'invited') {
      const { error: confirmErr } = await admin.from('group_booking_members').update({
        status: 'confirmed',
        joined_at: new Date().toISOString(),
      }).eq('id', existing.id);
      if (confirmErr) {
        console.error('[group-booking/join] invited member confirm failed', { memberId: existing.id, err: confirmErr });
        return NextResponse.json({ error: 'グループへの参加に失敗しました。' }, { status: 500 });
      }
    }
    return NextResponse.json({ group_id: group.id, already_joined: true });
  }

  // Atomic capacity increment: only succeeds if there is still room.
  // This prevents race conditions where two concurrent requests both pass
  // the capacity check and both get inserted, exceeding total_members.
  const { data: incremented, error: incError } = await admin
    .from('group_bookings')
    .update({ confirmed_members: group.confirmed_members + 1 })
    .eq('id', group.id)
    .eq('confirmed_members', group.confirmed_members)        // optimistic lock
    .lt('confirmed_members', group.total_members)            // capacity guard
    .select('id')
    .single();

  if (incError || !incremented) {
    // Either the count changed under us (another join won the race) or it was already full.
    return NextResponse.json({ error: 'グループの人数が上限に達しています' }, { status: 409 });
  }

  // Add user as member (capacity slot is already secured above)
  const { error: memberErr } = await admin.from('group_booking_members').insert({
    group_booking_id: group.id,
    user_id: user.id,
    status: 'confirmed',
    is_organizer: false,
    joined_at: new Date().toISOString(),
  });

  if (memberErr) {
    // Capacity was incremented but member row failed — roll back the count.
    console.error('[group-booking/join] member insert failed, rolling back confirmed_members', { groupId: group.id, err: memberErr });
    await admin
      .from('group_bookings')
      .update({ confirmed_members: group.confirmed_members })
      .eq('id', group.id);
    return NextResponse.json({ error: 'グループへの参加に失敗しました。もう一度お試しください。' }, { status: 500 });
  }

  return NextResponse.json({ group_id: group.id, joined: true });
}
