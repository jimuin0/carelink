/**
 * グループ予約 API
 * POST /api/group-booking — グループ予約作成
 * GET  /api/group-booking?code=XXXX — シェアコードで参加情報取得
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

const CreateSchema = z.object({
  facility_id: z.string().uuid(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  menu_id: z.string().uuid().optional(),
  staff_id: z.string().uuid().optional(),
  total_members: z.number().int().min(2).max(10),
  notes: z.string().max(500).optional(),
  guest_members: z.array(z.object({
    name: z.string().max(50),
    email: z.string().email().optional(),
    phone: z.string().max(20).optional(),
  })).max(9).optional(),
});

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 5, 60_000, 'group-booking')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  const data = parsed.data;

  const admin = createServiceRoleClient();

  // Verify facility exists
  const { data: facility } = await admin.from('facility_profiles').select('id, status').eq('id', data.facility_id).single();
  if (!facility || facility.status !== 'published') return NextResponse.json({ error: '施設が見つかりません' }, { status: 404 });

  // Create group booking
  const { data: groupBooking, error } = await admin.from('group_bookings').insert({
    facility_id: data.facility_id,
    organizer_id: user.id,
    booking_date: data.booking_date,
    start_time: data.start_time,
    end_time: data.end_time,
    menu_id: data.menu_id ?? null,
    staff_id: data.staff_id ?? null,
    total_members: data.total_members,
    confirmed_members: 1,
    notes: data.notes ?? null,
  }).select('id, share_code').single();

  if (error || !groupBooking) {
    return NextResponse.json({ error: 'グループ予約の作成に失敗しました' }, { status: 500 });
  }

  // Add organizer as first member
  await admin.from('group_booking_members').insert({
    group_booking_id: groupBooking.id,
    user_id: user.id,
    status: 'confirmed',
    is_organizer: true,
    joined_at: new Date().toISOString(),
  });

  // Add guest members if provided
  if (data.guest_members && data.guest_members.length > 0) {
    await admin.from('group_booking_members').insert(
      data.guest_members.map((g) => ({
        group_booking_id: groupBooking.id,
        guest_name: g.name,
        guest_email: g.email ?? null,
        guest_phone: g.phone ?? null,
        status: 'invited',
        is_organizer: false,
      }))
    );
  }

  return NextResponse.json({
    id: groupBooking.id,
    share_code: groupBooking.share_code,
    share_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://carelink-jp.com'}/group-booking/join/${groupBooking.share_code}`,
  }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code || code.length > 20) return NextResponse.json({ error: 'code required' }, { status: 400 });

  const admin = createServiceRoleClient();

  const { data: group } = await admin
    .from('group_bookings')
    .select(`
      id, share_code, booking_date, start_time, end_time, total_members, confirmed_members,
      status, notes, menu_id, staff_id,
      facility_profiles(id, name, slug, address, phone),
      facility_menus(name, price),
      facility_staff(name)
    `)
    .eq('share_code', code.toUpperCase())
    .single();

  if (!group) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });

  // Don't expose cancelled groups
  if (group.status === 'cancelled') return NextResponse.json({ error: 'この予約はキャンセルされました' }, { status: 410 });

  const { data: members } = await admin
    .from('group_booking_members')
    .select('id, guest_name, status, is_organizer, joined_at')
    .eq('group_booking_id', group.id);

  return NextResponse.json({ group, members: members ?? [] });
}
