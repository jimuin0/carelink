import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { isStockImageUrl, isNewStockImage, STOCK_IMAGE_ERROR } from '@/lib/stock-image-guard';

// POST(route.ts)と同じ理由・同じ設計（SafeHtmlContent.tsx の href 検証と同方針）で、
// image_url/href に javascript:/data: 等の危険スキームを許さないホワイトリスト方式にする。
const SAFE_HREF_PATTERN = /^(?:https:\/\/|\/(?!\/))/;

const featureUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  subtitle: z.string().max(300).optional().nullable(),
  image_url: z.string().url().max(500).startsWith('https://').optional().nullable().or(z.literal('')),
  href: z.string().max(300).optional().nullable()
    .refine((v) => !v || SAFE_HREF_PATTERN.test(v), '不正なリンク先です'),
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

  // ストック写真ガード（src/lib/stock-image-guard.ts）。既存値と同一なら素通しする＝
  // ストック画像が残っている記事のタイトル修正等を壊さないため（管理画面はフォーム全体を
  // 送るので、画像を変えない更新でも image_url は必ず載ってくる）。
  // 差し替えが必要なときだけ 1 回追加でクエリするので、通常経路のコストは増えない。
  if (isStockImageUrl(parsed.data.image_url)) {
    const { data: current } = await admin
      .from('feature_articles')
      .select('image_url')
      .eq('id', params.id)
      .maybeSingle();
    if (isNewStockImage(parsed.data.image_url, current?.image_url ?? null)) {
      return NextResponse.json({ error: STOCK_IMAGE_ERROR }, { status: 400 });
    }
  }

  // 【2026年8月11日 恒久根治】空文字は「画像を外す」意思表示なので null に倒す。ただし
  // 【キーが送られてこなかったときは触らない】。以前は
  // `{ ...parsed.data, image_url: parsed.data.image_url || null }` と書いており、zod の optional は
  // 未指定キーを出力に含めないため、image_url を含まない PATCH でも常に null が上書きされていた。
  // 管理画面の公開/非公開トグルは `{ is_active }` だけを送るため、【トグルするだけで特集記事の
  // 画像が無言で消えていた】。blog/[id] と同じ「未定義なら足さない」形に揃える。
  const updatePayload: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.image_url !== undefined) {
    updatePayload.image_url = parsed.data.image_url || null;
  }

  const { data, error } = await admin
    .from('feature_articles')
    // feature_articles に updated_at 列は無い（created_at のみ）→ 書き込むと 400 になるため付けない
    .update(updatePayload)
    .eq('id', params.id)
    .select()
    // .maybeSingle(): 該当0行（存在しないid）を not found として扱う。.single() だと0行→PGRST116で
    // 下の if(error)→500 が先に発火し if(!data)→404 が到達不能になる（404がデッドコード・500に化ける）。
    .maybeSingle();

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
