import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';

const featureArticleSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).optional().nullable(),
  image_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  href: z.string().max(300).optional().nullable(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-features-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  // feature_articles はサイトワイドコンテンツ(facility_idを持たない) — プラットフォーム管理者のみ編集可（監査A6b）
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = user.id;

  const body = await request.json().catch(() => null);
  const parsed = featureArticleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('feature_articles').insert({
    title: parsed.data.title,
    subtitle: parsed.data.subtitle ?? null,
    image_url: parsed.data.image_url || null,
    href: parsed.data.href ?? null,
    is_active: parsed.data.is_active ?? true,
    sort_order: parsed.data.sort_order ?? 0,
    // feature_articles に updated_at 列は存在しない（created_at のみ）→ 書き込むと 400 になるため付けない
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({
    userId,
    action: 'create',
    tableName: 'feature_articles',
    recordId: data.id,
    newValues: { title: data.title, is_active: data.is_active },
    ipAddress: ip,
  });

  return NextResponse.json({ feature: data }, { status: 201 });
}
