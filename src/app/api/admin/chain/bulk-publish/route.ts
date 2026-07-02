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
import { checkPublishReadiness } from '@/lib/facility-publish-gate';

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'bulk-publish')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { facility_ids, is_published } = await req.json().catch(() => ({}));
  if (!facility_ids?.length || typeof is_published !== 'boolean') {
    return NextResponse.json({ error: 'facility_ids and is_published are required' }, { status: 400 });
  }
  if (!Array.isArray(facility_ids) || facility_ids.length > 50) {
    return NextResponse.json({ error: 'facility_ids must be array of at most 50' }, { status: 400 });
  }
  if (!facility_ids.every((id: unknown) => typeof id === 'string' && UUID_REGEX.test(id))) {
    return NextResponse.json({ error: 'Invalid facility_ids' }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // 権限確認
  const { data: memberships } = await admin
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .in('facility_id', facility_ids);

  const allowedIds = (memberships ?? []).map((m) => m.facility_id);
  if (allowedIds.length !== facility_ids.length) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 公開(published)にする場合は、単一公開(admin/settings)と同じ必須項目ゲートを施設ごとに適用する。
  // 旧実装はこの検証を一切せず、メニュー/写真/スタッフ0件の未完成施設をそのまま公開でき、
  // 検索に出た後の予約ページで客が行き止まりになった（BP-1）。満たさない施設は公開対象から外し、
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
    if (checks.some((c) => c.gateErr)) {
      return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    }
    targetIds = checks.filter((c) => c.readiness.ready).map((c) => c.fid);
    for (const c of checks) {
      if (!c.readiness.ready) skipped.push({ facility_id: c.fid, missing: c.readiness.missing });
    }
  }

  if (targetIds.length > 0) {
    const { error } = await admin
      .from('facility_profiles')
      .update({ status: is_published ? 'published' : 'draft', updated_at: new Date().toISOString() })
      .in('id', targetIds);

    if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
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
}
