import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

// treatment_catalogs は Before/After 等の症例カタログ（実列: title, description, tags[],
// before_photo_url, after_photo_url）。旧 schema は name/price/category/duration_minutes/
// is_published を treatment_catalogs に insert しており、これらの列が存在しないため作成が
// 常に 400 で失敗していた。フォームの入力（タイトル=name / 説明 / タグ）に合わせて実列へ保存する。
const catalogSchema = z.object({
  name: z.string().min(1).max(200), // フォームは title を name として送信 → treatment_catalogs.title へ
  description: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional().nullable(),
});

async function getAdminInfo(request: NextRequest): Promise<{ facilityId: string; userId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;

  const { data } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();

  return data ? { facilityId: data.facility_id, userId: user.id } : null;
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-catalog-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = catalogSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('treatment_catalogs').insert({
    facility_id: auth.facilityId,
    title: parsed.data.name,
    description: parsed.data.description ?? null,
    tags: parsed.data.tags ?? null,
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ip: auditIp, ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'create',
    tableName: 'treatment_catalogs',
    recordId: data.id,
    newValues: { title: parsed.data.name },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ item: data }, { status: 201 });
}
