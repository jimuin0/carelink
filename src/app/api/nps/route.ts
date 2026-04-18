import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { z } from 'zod';
import { createHash } from 'crypto';

const schema = z.object({
  score: z.number().int().min(0).max(10),
  facility_id: z.string().uuid().optional(),
  booking_id: z.string().uuid().optional(),
  comment: z.string().max(500).optional(),
  category: z.enum(['facility', 'platform', 'overall']).optional(),
});

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 5, 60_000 * 60, 'nps')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 16);

  const admin = createServiceRoleClient();

  // Verify booking_id ownership: the booking must belong to the authenticated user
  let verifiedBookingId: string | null = parsed.data.booking_id ?? null;
  if (verifiedBookingId && user) {
    const { data: booking } = await admin
      .from('bookings')
      .select('id')
      .eq('id', verifiedBookingId)
      .eq('user_id', user.id)
      .single();
    if (!booking) verifiedBookingId = null; // reject unowned booking_id silently
  } else if (verifiedBookingId && !user) {
    // Unauthenticated users cannot claim a booking
    verifiedBookingId = null;
  }

  const { error } = await admin.from('nps_surveys').insert({
    user_id: user?.id ?? null,
    facility_id: parsed.data.facility_id ?? null,
    booking_id: verifiedBookingId,
    score: parsed.data.score,
    comment: parsed.data.comment ?? null,
    category: parsed.data.category ?? 'overall',
    ip_hash: ipHash,
  });

  if (error) {
    // 重複エラーは無視（同月回答済み）
    if (error.code === '23505') return NextResponse.json({ message: 'already_submitted' });
    return NextResponse.json({ error: '送信に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ message: 'submitted' }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId) return NextResponse.json({ error: 'facility_id required' }, { status: 400 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(facilityId)) {
    return NextResponse.json({ error: 'Invalid facility_id' }, { status: 400 });
  }

  const { data: mem } = await supabase
    .from('facility_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();
  if (!mem) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('nps_surveys')
    .select('score, comment, created_at')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false })
    .limit(100);

  const scores = (data ?? []).map((r) => r.score);
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const nps = scores.length > 0 ? Math.round(((promoters - detractors) / scores.length) * 100) : null;

  return NextResponse.json({ nps, count: scores.length, data });
}
