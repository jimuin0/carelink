import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { checkCsrf } from '@/lib/csrf';
import { z } from 'zod';
import { serverError } from '@/lib/with-route';

const schema = z.object({
  score: z.number().int().min(0).max(10),
  facility_id: z.string().uuid().optional(),
  booking_id: z.string().uuid().optional(),
  comment: z.string().max(500).optional(),
  category: z.enum(['facility', 'platform', 'overall']).optional(),
});

async function submitNps(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 5, 60_000 * 60, 'nps')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();

  // Verify booking_id ownership: the booking must belong to the authenticated user
  let verifiedBookingId: string | null = parsed.data.booking_id ?? null;
  let verifiedFacilityId: string | null = parsed.data.facility_id ?? null;
  if (verifiedBookingId && user) {
    const { data: booking, error: bookingError } = await admin
      .from('bookings')
      .select('id, facility_id')
      .eq('id', verifiedBookingId)
      .eq('user_id', user.id)
      // 所有する予約が0件なのは通常の業務入力であり、PostgRESTのPGRST116をDB障害として
      // 500化しない。maybeSingle は0件を data:null/error:null で返す。
      .maybeSingle();
    if (bookingError) return serverError('nps-booking-verify', bookingError, '/api/nps', '送信に失敗しました');
    if (!booking) {
      verifiedBookingId = null; // reject unowned booking_id silently
    } else {
      // 予約に紐づく回答の施設はクライアント入力でなく、所有確認済み予約の値を正とする。
      if (verifiedFacilityId && verifiedFacilityId !== booking.facility_id) {
        return NextResponse.json({ error: 'booking_id と facility_id が一致しません' }, { status: 400 });
      }
      verifiedFacilityId = booking.facility_id;
    }
  } else if (verifiedBookingId && !user) {
    // Unauthenticated users cannot claim a booking
    verifiedBookingId = null;
  }

  const { error } = await admin.from('nps_surveys').insert({
    user_id: user?.id ?? null,
    facility_id: verifiedFacilityId,
    booking_id: verifiedBookingId,
    score: parsed.data.score,
    comment: parsed.data.comment ?? null,
    category: parsed.data.category ?? 'overall',
    // IPは短い候補空間の値であり、plain hashでも再識別され得る。重複制約・集計はこの列を
    // 参照していないため、新規保存を止める。既存データは本変更で削除しない。
    ip_hash: null,
  });

  if (error) {
    // 重複エラーは無視（同月回答済み）
    if (error.code === '23505') return NextResponse.json({ message: 'already_submitted' });
    return serverError('nps-post', error, '/api/nps', '送信に失敗しました');
  }

  return NextResponse.json({ message: 'submitted' }, { status: 201 });
}

async function readNps(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'nps-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId) return NextResponse.json({ error: 'facility_id required' }, { status: 400 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(facilityId)) {
    return NextResponse.json({ error: 'Invalid facility_id' }, { status: 400 });
  }

  const { data: mem, error: membershipError } = await supabase
    .from('facility_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    // 非会員は認可拒否であってDB障害ではない。
    .maybeSingle();
  if (membershipError) return serverError('nps-membership', membershipError, '/api/nps', '集計を取得できませんでした');
  if (!mem) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('nps_surveys')
    .select('score, comment, created_at')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return serverError('nps-get', error, '/api/nps', '集計を取得できませんでした');

  const scores = (data ?? []).map((r) => r.score);
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const nps = scores.length > 0 ? Math.round(((promoters - detractors) / scores.length) * 100) : null;

  return NextResponse.json({ nps, count: scores.length, data });
}

export async function POST(request: NextRequest) {
  try {
    return await submitNps(request);
  } catch (error) {
    return serverError('nps-post', error, '/api/nps', '送信に失敗しました');
  }
}

export async function GET(request: NextRequest) {
  try {
    return await readNps(request);
  } catch (error) {
    return serverError('nps-get', error, '/api/nps', '集計を取得できませんでした');
  }
}
