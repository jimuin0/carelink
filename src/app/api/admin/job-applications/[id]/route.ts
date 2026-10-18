import { applicationPatchSchema, applicationUpdateReceiptSchema } from '@/lib/job-application-validation';
import { readAuthorization } from '@/lib/authorization-read';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';

async function patchApplication(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'job-applications-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const applicationId = params.id.toLowerCase();

  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-job-applications-auth', '/api/admin/job-applications/[id]');
  const user = verification.state === 'verified' ? verification.user : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  // Verify ownership — both "not found" and "wrong owner" return 404 to prevent ID enumeration
  const { data: existing, error: existingError } = await readAuthorization(admin
    .from('job_applications')
    .select('facility_id, status')
    .eq('id', applicationId)
    .maybeSingle()).catch(error => ({ data: null, error }));

  if (existingError) {
    const response = serverError('admin-job-applications-read', databaseDiagnostic(existingError), '/api/admin/job-applications/[id]');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  const { data: membership, error: membershipError } = existing
    ? await readAuthorization(admin
        .from('facility_members')
        .select('role')
        .eq('facility_id', existing.facility_id)
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin'])
        .maybeSingle()).catch(error => ({ data: null, error }))
    : { data: null, error: null };

  if (membershipError) {
    const response = serverError('admin-job-applications-membership', databaseDiagnostic(membershipError), '/api/admin/job-applications/[id]');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  if (!existing || !membership) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const parsed = applicationPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid application patch' }, { status: 400 });
  const updates = parsed.data;
  const { data, error } = await admin.rpc('update_job_application_atomic', {
    p_actor_id: user.id, p_facility_id: existing.facility_id, p_application_id: applicationId, p_patch: updates,
  });
  if (error?.code === '42501' || error?.code === 'P0002') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (error?.code === '22023') return NextResponse.json({ error: 'Invalid application patch' }, { status: 400 });
  if (error) return serverError('admin-job-applications-patch', databaseDiagnostic(error), '/api/admin/job-applications/[id]');
  const receipt = applicationUpdateReceiptSchema.safeParse(data);
  if (!receipt.success || receipt.data.application.id !== applicationId || receipt.data.application.facility_id !== existing.facility_id
    || (updates.status !== undefined && receipt.data.application.status !== updates.status)) return serverError('admin-job-applications-patch-receipt', new Error('APPLICATION_RESULT_UNCONFIRMED'), '/api/admin/job-applications/[id]');
  const application = receipt.data.application;

  const { ua } = getRequestContext(req);
  void writeAuditLog({
    userId: user.id,
    facilityId: existing.facility_id,
    action: 'update',
    tableName: 'job_applications',
    recordId: applicationId,
    oldValues: { status: receipt.data.previous_status },
    newValues: updates,
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ application });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const response = await patchApplication(req, props); response.headers.set('Cache-Control', 'no-store'); return response;
  } catch (error) {
    const response = serverError('admin-job-applications-patch-dependency', databaseDiagnostic(error), '/api/admin/job-applications/[id]');
    response.headers.set('Cache-Control', 'no-store'); return response;
  }
}
