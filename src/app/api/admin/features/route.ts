import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { isStockImageUrl, STOCK_IMAGE_ERROR } from '@/lib/stock-image-guard';
import { serverError } from '@/lib/with-route';

// 【2026年7月29日・恒久根治】zod の .url() は WHATWG URL としてパース可能かのみを検証し、
// スキームを制限しない。"javascript:alert(1)" や "data:text/html,<script>..." は
// 構文的に有効な URL のため .url() を通過してしまう（実際に new URL() でパース可能）。
// image_url は <img src> でも data:image/svg+xml 経由の XSS が成立しうる。href は将来
// <a href> として展開される想定のため javascript: を直接実行されうる。https:// もしくは
// "//" で始まらない（＝プロトコル相対でホストを差し替えられない）相対パスのみ許可する
// ホワイトリスト方式に統一する（SafeHtmlContent.tsx の href 検証と同じ設計方針）。
const SAFE_HREF_PATTERN = /^(?:https:\/\/|\/(?!\/))/;

const featureArticleSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).optional().nullable(),
  image_url: z.string().url().max(500).startsWith('https://').optional().nullable().or(z.literal('')),
  href: z.string().max(300).optional().nullable()
    .refine((v) => !v || SAFE_HREF_PATTERN.test(v), '不正なリンク先です'),
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

  // ストック写真の新規登録を拒否する（src/lib/stock-image-guard.ts）。新規作成なので
  // 「既存値と同じ」は原理上ありえず、素通し条件は不要。
  if (isStockImageUrl(parsed.data.image_url)) {
    return NextResponse.json({ error: STOCK_IMAGE_ERROR }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  // 【型検査で判明した実バグ】feature_articles.href は migration
  // （supabase/migrations/20260417000024_phase7_hpb_extensions.sql）では `TEXT`（NOT NULL 制約なし＝
  // nullable）と宣言されているが、本番から生成された Database 型（src/types/database.types.ts）は
  // `href: string`（NOT NULL）になっている＝migration と本番の間にドリフトがある
  // （プロジェクトの既知パターン。migration 側の追従は本タスクのスコープ外のため据え置く）。
  // Database 型は本番 introspection が正なので、null を渡すと本番の NOT NULL 制約に違反し
  // insert が常に失敗する（＝リンクURLを未入力のまま特集記事を作成すると必ず500になっていた
  // 実バグ）。「リンクなし」の意図は空文字列で表現し、NOT NULL を満たしつつ意味を保つ。
  const { data, error } = await admin.from('feature_articles').insert({
    title: parsed.data.title,
    subtitle: parsed.data.subtitle ?? null,
    image_url: parsed.data.image_url || null,
    href: parsed.data.href || '',
    is_active: parsed.data.is_active ?? true,
    sort_order: parsed.data.sort_order ?? 0,
    // feature_articles に updated_at 列は存在しない（created_at のみ）→ 書き込むと 400 になるため付けない
  }).select().single();

  if (error) return serverError('admin-features-create', error, '/api/admin/features');

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
