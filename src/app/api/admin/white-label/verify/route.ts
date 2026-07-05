import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { promises as dns } from 'dns';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { getAdminFacilityIds, resolveTargetFacilityId } from '@/lib/facility-membership';

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 5, 60_000, 'white-label-verify')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 監査A2: white-label/route.tsと同一パターン。POSTはbody未読前提のためbodyから
  // facility_idを受け取る(空bodyでもJSONパース失敗を許容)。既存どおりservice roleで問い合わせる。
  const { facility_id } = await req.json().catch(() => ({} as { facility_id?: unknown }));
  const admin = createServiceRoleClient();
  const facilityIds = await getAdminFacilityIds(admin, user.id);
  const { facilityId, reason } = resolveTargetFacilityId(facilityIds, facility_id);
  if (reason === 'none') return NextResponse.json({ error: 'No facility' }, { status: 403 });
  if (reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'ambiguous') return NextResponse.json({ error: '施設を指定してください', facilityIds }, { status: 400 });

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
      void writeAuditLog({
        userId: user.id,
        facilityId,
        action: 'verify',
        tableName: 'white_label_domains',
        newValues: { domain: config.domain, is_verified: true },
        ipAddress: ip,
      });
    }

    return NextResponse.json({ verified });
  } catch {
    // DNS lookup failed
    return NextResponse.json({ verified: false, reason: 'DNS lookup failed' });
  }
}
