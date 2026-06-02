import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { inMemoryRateLimit } from '@/lib/rate-limit';

// お客様カルテの属性（誕生日・性別・エリア）取得。
// profiles は本人のみ参照可の RLS のため、ブラウザ+認証クライアントでは他顧客分を読めない。
// service-role で取得するが、(1) 当該施設の owner/admin であること、
// (2) その email が当該施設の予約に実在する顧客であること、を検証してから最小項目のみ返す。
async function getAdminFacilityId(request: NextRequest): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;
  const { data } = await supabase
    .from('facility_members').select('facility_id')
    .eq('user_id', user.id).eq('facility_id', facilityId).in('role', ['owner', 'admin']).single();
  return data?.facility_id ?? null;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 60, 60_000, 'customer-profile-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const email = request.nextUrl.searchParams.get('email');
  if (!email || email.length > 254) return NextResponse.json({ error: 'email が不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  // 当該施設の予約に存在する email のみ照会可（他施設・無関係な顧客の属性を引けないようにする）
  const { data: belongs } = await admin
    .from('bookings').select('id').eq('facility_id', facilityId).eq('email', email).limit(1).maybeSingle();
  if (!belongs) return NextResponse.json({ profile: null });

  const { data: profile, error } = await admin
    .from('profiles').select('birth_date, gender, prefecture, city').eq('email', email).maybeSingle();
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  return NextResponse.json({ profile: profile ?? null });
}
