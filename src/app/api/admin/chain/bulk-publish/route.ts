/**
 * POST /api/admin/chain/bulk-publish
 * チェーン全施設の公開/非公開を一括変更
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { UUID_REGEX } from '@/lib/constants';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { checkPublishReadiness, isPublishedLocationConflict } from '@/lib/facility-publish-gate';
import { serverError } from '@/lib/with-route';

export async function POST(req: NextRequest) {
  try {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'bulk-publish')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed: unknown = await req.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { facility_ids, is_published } = parsed as { facility_ids?: unknown; is_published?: unknown };
  if (typeof is_published !== 'boolean') {
    return NextResponse.json({ error: 'facility_ids and is_published are required' }, { status: 400 });
  }
  if (!Array.isArray(facility_ids) || facility_ids.length === 0 || facility_ids.length > 50 || new Set(facility_ids).size !== facility_ids.length) {
    return NextResponse.json({ error: 'facility_ids must be array of at most 50' }, { status: 400 });
  }
  if (!facility_ids.every((id: unknown) => typeof id === 'string' && UUID_REGEX.test(id))) {
    return NextResponse.json({ error: 'Invalid facility_ids' }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // 権限確認
  const { data: memberships, error: membershipError } = await admin
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .in('facility_id', facility_ids);

  if (membershipError) return serverError('admin-chain-bulk-publish-membership', membershipError, '/api/admin/chain/bulk-publish');
  const allowedIds = (memberships ?? []).map((m) => m.facility_id);
  if (allowedIds.length !== facility_ids.length) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 公開(published)にする場合は、単一公開(admin/settings)と同じ必須項目ゲートを施設ごとに適用する。
  // 掲載専用の条件を満たさない施設は公開対象から外し、
  // skipped で理由を返す。非公開(draft)化はゲート不要。
  let targetIds: string[] = facility_ids;
  const skipped: { facility_id: string; missing: string[] }[] = [];
  if (is_published) {
    const checks = await Promise.all(
      facility_ids.map(async (fid: string) => {
        const { readiness, error: gateErr } = await checkPublishReadiness(admin, fid);
        return { fid, readiness, gateErr };
      })
    );
    const gateFailure = checks.find((c) => c.gateErr);
    if (gateFailure) {
      return serverError('admin-chain-bulk-publish-gate', gateFailure.gateErr, '/api/admin/chain/bulk-publish');
    }
    targetIds = checks.filter((c) => c.readiness.ready).map((c) => c.fid);
    for (const c of checks) {
      if (!c.readiness.ready) skipped.push({ facility_id: c.fid, missing: c.readiness.missing });
    }
  }

  if (targetIds.length > 0) {
    // The earlier reads explain skipped items. Authorization and location are
    // checked again under row locks at the actual transaction boundary.
    const { data: updated, error } = await admin.rpc('set_facilities_publication_atomic', {
      p_actor_id: user.id, p_facility_ids: targetIds, p_is_published: is_published,
    });

    if (error?.message.includes('FACILITY_PERMISSION_REVOKED')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error?.message.includes('FACILITY_OWNER_REQUIRED')) return NextResponse.json({ error: '店舗所有者の確認が必要です。今回の変更は保存されていません。' }, { status: 409 });
    if (isPublishedLocationConflict(error)) return NextResponse.json({ error: '所在地が変更された施設があります。今回の一括更新は保存されていません。所在地を確認してください。' }, { status: 409 });
    if (error) return serverError('admin-chain-bulk-publish-update', error, '/api/admin/chain/bulk-publish');
    if (!Array.isArray(updated) || updated.length !== targetIds.length
      || new Set(updated.map(row => row.id)).size !== targetIds.length || updated.some(row => !targetIds.includes(row.id))) {
      return serverError('admin-chain-bulk-publish-result', new Error('updated facilities not confirmed'), '/api/admin/chain/bulk-publish', '変更結果を確認できません。現在の公開状態を確認してください。');
    }
  }

  const { ip: auditIp, ua } = getRequestContext(req);
  void writeAuditLog({
    userId: user.id,
    action: 'update',
    tableName: 'facility_profiles',
    newValues: { is_published, facility_ids: targetIds, count: targetIds.length },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true, updated: targetIds.length, skipped });
  } catch (error) {
    return serverError('admin-chain-bulk-publish', error, '/api/admin/chain/bulk-publish');
  }
}
