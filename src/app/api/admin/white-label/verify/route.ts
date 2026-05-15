import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { promises as dns } from 'dns';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

async function getFacilityId(userId: string) {
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .in('role', ['owner', 'admin'])
    .limit(1)
    .single();
  return data?.facility_id;
}

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 5, 60_000, 'white-label-verify')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await getFacilityId(user.id);
  if (!facilityId) return NextResponse.json({ error: 'No facility' }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data: config } = await admin
    .from('white_label_domains')
    .select('domain, txt_record')
    .eq('facility_id', facilityId)
    .single();

  if (!config) return NextResponse.json({ error: 'No domain configured' }, { status: 400 });

  try {
    // Look up TXT records for _carelink-verify.<domain>
    const records = await dns.resolveTxt(`_carelink-verify.${config.domain}`);
    const flatRecords = records.flat();
    const verified = flatRecords.some((r) => r === config.txt_record);

    if (verified) {
      const { error: verifyUpdateErr } = await admin
        .from('white_label_domains')
        .update({ is_verified: true, verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('facility_id', facilityId);
      if (verifyUpdateErr) {
        console.error('[white-label/verify] domain verify update failed', { facilityId, err: verifyUpdateErr });
        return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
      }
    }

    return NextResponse.json({ verified });
  } catch {
    // DNS lookup failed
    return NextResponse.json({ verified: false, reason: 'DNS lookup failed' });
  }
}
