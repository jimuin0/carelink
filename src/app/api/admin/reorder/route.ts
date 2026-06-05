import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';

// 並び替えの原子化（監査 #13/#14）。id 配列を1トランザクションの RPC で sort_order=0..N-1 に一括設定する。
// 逐次 PATCH ループ（途中失敗で部分保存・順序不整合）を置換する。
const RPC_BY_ENTITY: Record<string, string> = {
  photos: 'reorder_facility_photos',
  coupons: 'reorder_coupons',
  menus: 'reorder_facility_menus',
};

const bodySchema = z.object({
  entity: z.enum(['photos', 'coupons', 'menus']),
  ids: z.array(z.string().uuid()).min(1).max(500),
});

async function getAdminInfo(request: NextRequest): Promise<{ facilityId: string; userId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;
  const { data } = await supabase
    .from('facility_members').select('facility_id')
    .eq('user_id', user.id).eq('facility_id', facilityId).in('role', ['owner', 'admin']).single();
  return data ? { facilityId: data.facility_id, userId: user.id } : null;
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'admin-reorder')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  // RPC 内で facility_id を WHERE に含めるため、他施設の行は並び替わらない（IDOR防御）
  const { error } = await admin.rpc(RPC_BY_ENTITY[parsed.data.entity], { p_facility_id: auth.facilityId, p_ids: parsed.data.ids });
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({ userId: auth.userId, facilityId: auth.facilityId, action: 'update', tableName: parsed.data.entity, recordId: 'reorder', ipAddress: ip });
  return NextResponse.json({ ok: true });
}
