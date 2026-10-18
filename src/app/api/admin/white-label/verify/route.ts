import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { saveAdminFacilityIntegration } from '@/lib/admin-facility-integration-write';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { promises as dns } from 'dns';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { getAdminFacilityIds, resolveTargetFacilityId } from '@/lib/facility-membership';
import { serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 5, 60_000, 'white-label-verify')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-facility-auth', '/api/admin/white-label/verify');
  const user = verification.state === 'verified' ? verification.user : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 監査A2: white-label/route.tsと同一パターン。POSTはbody未読前提のためbodyから
  // facility_idを受け取る。壊れたJSONは拒否し、既存どおりservice roleで問い合わせる。
  const body=await req.json().catch(()=>null);
  if(body===null||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Invalid request'},{status:400});
  const {facility_id}=body;
  const admin = createServiceRoleClient();
  const facilityIds = await getAdminFacilityIds(admin, user.id, '/api/admin/white-label/verify');
  if (facilityIds instanceof NextResponse) return facilityIds;
  const { facilityId, reason } = resolveTargetFacilityId(facilityIds, facility_id);
  if (reason === 'none') return NextResponse.json({ error: 'No facility' }, { status: 403 });
  if (reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'ambiguous') return NextResponse.json({ error: '施設を指定してください', facilityIds }, { status: 400 });

  const { data: config, error: configError } = await admin
    .from('white_label_domains')
    .select('domain, txt_record')
    .eq('facility_id', facilityId)
    .maybeSingle();

  if(configError)return serverError('admin-white-label-verify-read',databaseDiagnostic(configError),'/api/admin/white-label/verify');
  if (!config) return NextResponse.json({ error: 'No domain configured' }, { status: 400 });

  if (!config.txt_record) return NextResponse.json({ verified: false, reason: 'Verification token missing' });

  try {
    // Look up TXT records for _carelink-verify.<domain>
    const records = await dns.resolveTxt(`_carelink-verify.${config.domain}`);
    // Each inner array is one TXT record, possibly split into multiple chunks.
    const verified = records.some((parts) => parts.join('') === config.txt_record);

    if (verified) {
      const saved=await saveAdminFacilityIntegration({actorId:user.id,facilityId,kind:'domain:verify',expected:{domain:config.domain,txt_record:config.txt_record},values:{}});
      if(saved instanceof NextResponse){
        if(saved.status===409)return NextResponse.json({verified:false,reason:'Domain configuration changed during verification'});
        return saved;
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
