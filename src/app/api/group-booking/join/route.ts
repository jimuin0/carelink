/**
 * グループ予約参加 API
 * POST /api/group-booking/join
 * Body: { share_code: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const code = typeof body.share_code === 'string' ? body.share_code.toUpperCase().trim() : null;
  if (!code) return NextResponse.json({ error: 'share_code required' }, { status: 400 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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
      await admin.from('group_booking_members').update({
        status: 'confirmed',
        joined_at: new Date().toISOString(),
      }).eq('id', existing.id);
    }
    return NextResponse.json({ group_id: group.id, already_joined: true });
  }

  // Check capacity
  if (group.confirmed_members >= group.total_members) {
    return NextResponse.json({ error: 'グループの人数が上限に達しています' }, { status: 409 });
  }

  // Add user as member
  await admin.from('group_booking_members').insert({
    group_booking_id: group.id,
    user_id: user.id,
    status: 'confirmed',
    is_organizer: false,
    joined_at: new Date().toISOString(),
  });

  // Update confirmed count
  await admin.from('group_bookings').update({
    confirmed_members: group.confirmed_members + 1,
  }).eq('id', group.id);

  return NextResponse.json({ group_id: group.id, joined: true });
}
