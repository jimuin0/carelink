import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'job-applications-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  // Verify ownership — both "not found" and "wrong owner" return 404 to prevent ID enumeration
  const { data: existing } = await admin
    .from('job_applications')
    .select('facility_id, status')
    .eq('id', params.id)
    .single();

  const { data: membership } = existing
    ? await admin
        .from('facility_members')
        .select('role')
        .eq('facility_id', existing.facility_id)
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin'])
        .single()
    : { data: null };

  if (!existing || !membership) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { status, referral_fee_yen, notes } = await req.json().catch(() => ({}));

  const VALID_STATUSES = [
    'pending', 'reviewing', 'interview_scheduled', 'interview_done',
    'offer_made', 'hired', 'rejected', 'withdrawn',
  ];
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  // 【2026年7月29日・恒久根治】referral_fee_yen(INT列)は下限のみ Math.max(0, ...) で
  // 矯正しており、上限が無いまま任意の巨大数値を保存できていた（DB の integer 範囲=約21億は
  // 超えれば 500 で弾かれるが、それ未満の非現実的な巨額の紹介手数料はそのまま通ってしまう）。
  // 他の金額フィールド（coupon の discount_value 等）と同じ上限 9,999,999円で範囲外を明示的に拒否する。
  if (referral_fee_yen !== undefined && referral_fee_yen !== null) {
    if (typeof referral_fee_yen !== 'number' || !Number.isInteger(referral_fee_yen) || referral_fee_yen < 0 || referral_fee_yen > 9999999) {
      return NextResponse.json({ error: '紹介手数料は0〜9,999,999円の範囲の整数で入力してください' }, { status: 400 });
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) updates.status = status;
  if (referral_fee_yen !== undefined) updates.referral_fee_yen = referral_fee_yen;
  if (notes !== undefined) updates.notes = typeof notes === 'string' ? notes.slice(0, 2000) : null;
  if (status === 'hired' && existing.status !== 'hired') {
    updates.hired_at = new Date().toISOString();
  }

  // Include facility_id in WHERE as defence-in-depth (CAS guard against stale ownership read /
  // TOCTOU between the check above and this update). .maybeSingle(): 0行（TOCTOUで対象が他施設に
  // 変わった等）を not found として扱う。.single() だと0行→PGRST116で if(error)→500 に化ける
  // （menus/[id]・staff/[id] 等の同型 [id] ルートと統一）。
  const { data: application, error } = await admin
    .from('job_applications')
    .update(updates)
    .eq('id', params.id)
    .eq('facility_id', existing.facility_id)
    .select('*, job_postings(title)')
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!application) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { ua } = getRequestContext(req);
  void writeAuditLog({
    userId: user.id,
    facilityId: existing.facility_id,
    action: 'update',
    tableName: 'job_applications',
    recordId: params.id,
    oldValues: { status: existing.status },
    newValues: updates,
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ application });
}
