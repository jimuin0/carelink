import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const featureUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  subtitle: z.string().max(300).optional().nullable(),
  image_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  href: z.string().max(300).optional().nullable(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-features-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  // feature_articles はサイトワイドコンテンツ(facility_idを持たない) — プラットフォーム管理者のみ編集可（監査A6b）
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = user.id;

  const body = await request.json().catch(() => null);
  const parsed = featureUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('feature_articles')
    // feature_articles に updated_at 列は無い（created_at のみ）→ 書き込むと 400 になるため付けない
    .update({ ...parsed.data, image_url: parsed.data.image_url || null })
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId,
    facilityId: null,
    action: 'update',
    tableName: 'feature_articles',
    recordId: params.id,
    newValues: parsed.data,
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ feature: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-features-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = user.id;

  const admin = createServiceRoleClient();
  // 【2026年7月10日 恒久根治】削除件数を検証せず常に成功を返していたため、存在しないIDの
  // 削除試行（0件削除）も「成功」と偽装していた（phantom success）。.select() で削除された
  // 行を受け取り、0件なら404を返す。
  const { data, error } = await admin.from('feature_articles').delete().eq('id', params.id).select();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId,
    facilityId: null,
    action: 'delete',
    tableName: 'feature_articles',
    recordId: params.id,
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true });
}
