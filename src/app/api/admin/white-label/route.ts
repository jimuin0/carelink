import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { saveAdminFacilityIntegration } from '@/lib/admin-facility-integration-write';
import { randomBytes } from 'crypto';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { getAdminFacilityIds, resolveTargetFacilityId } from '@/lib/facility-membership';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'white-label-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-facility-auth', '/api/admin/white-label');
  const user = verification.state === 'verified' ? verification.user : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 監査A2: facility_id をリクエスト(クエリ)から受け取り所属集合で検証する。
  // 複数施設のowner/adminがfacility_id未指定の場合、DB返却順に依存した非決定的な
  // 施設選択（従来のlimit(1)決め打ち）を排し、明示指定を要求する。
  // (既存どおりservice roleクライアントでfacility_membersを問い合わせる)
  const admin = createServiceRoleClient();
  const facilityIds = await getAdminFacilityIds(admin, user.id, '/api/admin/white-label');
  if (facilityIds instanceof NextResponse) return facilityIds;
  const requested = req.nextUrl.searchParams.get('facility_id');
  const { facilityId, reason } = resolveTargetFacilityId(facilityIds, requested);
  if (reason === 'none') return NextResponse.json({ error: 'No facility' }, { status: 403 });
  if (reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'ambiguous') return NextResponse.json({ error: '施設を指定してください', facilityIds }, { status: 400 });

  const { data: config, error: configError } = await admin
    .from('white_label_domains')
    .select('*')
    .eq('facility_id', facilityId)
    .maybeSingle();

  if(configError)return serverError('admin-white-label-read',databaseDiagnostic(configError),'/api/admin/white-label');
  return NextResponse.json({config:config || null});
}

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'white-label')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-facility-auth', '/api/admin/white-label');
  const user = verification.state === 'verified' ? verification.user : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body=await req.json().catch(()=>null);
  if(body===null||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Invalid request'},{status:400});
  const {domain,brand_name,primary_color,logo_url,facility_id}=body;
  if([brand_name,primary_color,logo_url].some(v=>v!=null&&typeof v!=='string'))return NextResponse.json({error:'Invalid request'},{status:400});

  const admin = createServiceRoleClient();
  const facilityIds = await getAdminFacilityIds(admin, user.id, '/api/admin/white-label');
  if (facilityIds instanceof NextResponse) return facilityIds;
  const { facilityId, reason } = resolveTargetFacilityId(facilityIds, facility_id);
  if (reason === 'none') return NextResponse.json({ error: 'No facility' }, { status: 403 });
  if (reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'ambiguous') return NextResponse.json({ error: '施設を指定してください', facilityIds }, { status: 400 });

  if (!domain || typeof domain !== 'string') return NextResponse.json({ error: 'domain required' }, { status: 400 });
  if (domain.length > 253) return NextResponse.json({ error: 'domain too long' }, { status: 400 });

  // Validate domain format — split by label to avoid nested-quantifier ReDoS
  const labelRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
  const labels = domain.split('.');
  const domainValid = labels.length >= 2 && labels.every((label) => label.length >= 1 && label.length <= 63 && labelRegex.test(label));
  if (!domainValid) {
    return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 });
  }

  const txtRecord = `carelink-verify=${randomBytes(16).toString('hex')}`;

  const config=await saveAdminFacilityIntegration({actorId:user.id,facilityId,kind:'domain:configure',expected:{},values:{
    domain:domain.toLowerCase(),brand_name:brand_name ? brand_name.slice(0,100) : null,
    primary_color:primary_color && /^#[0-9a-fA-F]{6}$/.test(primary_color) ? primary_color : '#0ea5e9',
    logo_url:logo_url && /^https:\/\/[^\s]{1,490}$/.test(logo_url) ? logo_url : null,txt_record:txtRecord}});
  if(config instanceof NextResponse)return config;

  // カスタムドメイン設定は重要操作のため監査ログに記録（fire-and-forget・本体を止めない）。
  const { ua } = getRequestContext(req);
  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'update',
    tableName: 'white_label_domains',
    recordId: facilityId,
    newValues: { domain: domain.toLowerCase(), is_verified: false },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ config }, { status: 201 });
}
