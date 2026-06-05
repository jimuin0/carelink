/**
 * POST /api/admin/chain/bulk-publish
 * チェーン全施設の公開/非公開を一括変更
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX } from '@/lib/constants';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { revalidateFacilityPublicPages } from '@/lib/revalidate';

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'bulk-publish')) {
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

  // 公開判定の権威カラムは status='published'。is_published は read 経路が参照しないため、
  // status を更新する（旧実装は is_published のみ更新で公開状態が一切変わらない no-op だった・scale監査）。
  const newStatus = is_published ? 'published' : 'suspended';
  const { data: updated, error } = await admin
    .from('facility_profiles')
    .update({ status: newStatus, is_published, updated_at: new Date().toISOString() })
    .in('id', facility_ids)
    .select('slug');

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  // 各施設の公開ページ(ISR)を即時再検証（単体トグルと同様・反映漏れ防止）
  for (const row of updated ?? []) {
    revalidateFacilityPublicPages((row as { slug?: string }).slug);
  }

  const { ip: auditIp, ua } = getRequestContext(req);
  void writeAuditLog({
    userId: user.id,
    action: 'update',
    tableName: 'facility_profiles',
    newValues: { status: newStatus, is_published, facility_ids, count: facility_ids.length },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true, updated: facility_ids.length });
}
