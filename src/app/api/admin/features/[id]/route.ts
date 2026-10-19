import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { writePlatformEditor } from '@/lib/platform-editor-write';
import { platformControlResponse } from '@/lib/platform-control-write';
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
import type { Database } from '@/types/database.types';
import { serverError } from '@/lib/with-route';

// feature_articles の update() に渡すオブジェクトの型。
// Record<string, unknown> は Database 型配線後の update() が要求する
// 「宣言外キー拒否」の型と両立しない（インデックスシグネチャ型は余剰プロパティ無しを保証できない）。
// テーブルの Update 型そのものを使い、意味を変えずに型検査を通す。
type FeatureArticleUpdate = Database['public']['Tables']['feature_articles']['Update'];

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
}).refine(value=>Object.keys(value).length>0);

async function handlePATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
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
  if (user instanceof NextResponse) return user;
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
  let expectedImage:string|null=null;
  if (isStockImageUrl(parsed.data.image_url)) {
    const { data: current, error: currentError } = await admin
      .from('feature_articles')
      .select('image_url')
      .eq('id', params.id)
      .maybeSingle();
    if(currentError)return serverError('admin-feature-image-read',databaseDiagnostic(currentError),'/api/admin/features/[id]');
    if (isNewStockImage(parsed.data.image_url, current?.image_url ?? null)) {
      return NextResponse.json({ error: STOCK_IMAGE_ERROR }, { status: 400 });
    }
    expectedImage=parsed.data.image_url!;
  }

  // 【2026年8月11日 恒久根治】空文字は「画像を外す」意思表示なので null に倒す。ただし
  // 【キーが送られてこなかったときは触らない】。以前は
  // `{ ...parsed.data, image_url: parsed.data.image_url || null }` と書いており、zod の optional は
  // 未指定キーを出力に含めないため、image_url を含まない PATCH でも常に null が上書きされていた。
  // 管理画面の公開/非公開トグルは `{ is_active }` だけを送るため、【トグルするだけで特集記事の
  // 画像が無言で消えていた】。blog/[id] と同じ「未定義なら足さない」形に揃える。
  // href は spread せず undefined で上書きしておき、下の if ブロックで明示的に組み立て直す
  // （理由は直後のコメント参照。ここで spread した値をそのまま使うと NOT NULL 制約に違反しうる）。
  const updatePayload: FeatureArticleUpdate = { ...parsed.data, href: undefined };
  if (parsed.data.image_url !== undefined) {
    updatePayload.image_url = parsed.data.image_url || null;
  }
  // 【型検査で判明した実バグ】feature_articles.href は migration
  // （supabase/migrations/20260417000024_phase7_hpb_extensions.sql）では nullable だが、本番から
  // 生成された Database 型は `href?: string`（NOT NULL）＝migration と本番のドリフト
  // （migration 側の追従は本タスクのスコープ外）。parsed.data.href に null を渡すと本番の
  // NOT NULL 制約に違反し update が常に失敗する（＝リンクURLを空にして保存すると必ず500になる
  // 実バグだった）。image_url と同じ「未指定キーは触らない」形を保ちつつ、null/空文字は
  // 「リンクなし」を意味する空文字列に倒して NOT NULL を満たす。
  if (parsed.data.href !== undefined) {
    updatePayload.href = parsed.data.href || '';
  }

  const data=await writePlatformEditor(userId,params.id,'feature','update',updatePayload,'/api/admin/features/[id]',expectedImage);
  if(data instanceof NextResponse)return data;

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

async function handleDELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-features-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const user = await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = user.id;

  // 【2026年7月10日 恒久根治】削除件数を検証せず常に成功を返していたため、存在しないIDの
  // 削除試行（0件削除）も「成功」と偽装していた（phantom success）。.select() で削除された
  // 行を受け取り、0件なら404を返す。
  const data=await writePlatformEditor(userId,params.id,'feature','delete',{},'/api/admin/features/[id]');
  if(data instanceof NextResponse)return data;

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

export async function PATCH(request:NextRequest,props:{params:Promise<{id:string}>}){return platformControlResponse(()=>handlePATCH(request,props),'/api/admin/features/[id]');}

export async function DELETE(request:NextRequest,props:{params:Promise<{id:string}>}){return platformControlResponse(()=>handleDELETE(request,props),'/api/admin/features/[id]');}
