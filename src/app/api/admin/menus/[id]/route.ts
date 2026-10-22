import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { isStockImageUrl, isNewStockImage, STOCK_IMAGE_ERROR } from '@/lib/stock-image-guard';
import type { Database } from '@/types/database.types';
import { serverError } from '@/lib/with-route';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { saveAdminMenu } from '@/lib/admin-menu-write';

// facility_menus の update() に渡すオブジェクトの型。
// Record<string, unknown> は Database 型配線後の update() が要求する
// 「宣言外キー拒否」の型と両立しない（インデックスシグネチャ型は余剰プロパティ無しを保証できない）。
// テーブルの Update 型そのものを使い、意味を変えずに型検査を通す。
type FacilityMenuUpdate = Database['public']['Tables']['facility_menus']['Update'];

const menuUpdateSchema = z.object({
  category: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  price: z.number().int().min(0).max(9999999).optional().nullable(),
  price_note: z.string().max(100).optional().nullable(),
  duration_minutes: z.number().int().min(0).max(1440).optional().nullable(),
  photo_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  is_featured: z.boolean().optional(),
  // 公開／非公開の切替。HPB 一括反映のメニューは非公開（下書き）で作られるため、
  // これが無いと管理画面から公開できずネット予約が始められなかった。
  // 送られなかったときは spread に現れない＝DB 側で現在値が保たれる（部分更新の規約）。
  is_published: z.boolean().optional(),
  // 旧画面のsort_order入力を検知して409を返す。並び替えは専用の原子APIを使う。
  sort_order: z.number().int().min(0).max(999999).optional(),
});


export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-menus-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const ctx = await getAdminApiContext(request);
  if (ctx instanceof NextResponse) return ctx;

  const body = await request.json().catch(() => null);
  const parsed = menuUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.sort_order !== undefined) return NextResponse.json({ error: '画面を再読み込みして並び替えてください' }, { status: 409 });

  const admin = createServiceRoleClient();
  let expectedPhoto: string | null = null;
  let checkPhoto = false;

  // ストック写真ガード（src/lib/stock-image-guard.ts）。既存値と同一なら素通しする＝
  // ストック画像が残っているメニューの価格修正等を壊さないため（管理画面はフォーム全体を
  // 送るので、写真を変えない更新でも photo_url は必ず載ってくる）。
  // facility_id で絞るのは他施設のメニューの値を照会させないため（存在判定の情報漏れ防止）。
  if (isStockImageUrl(parsed.data.photo_url)) {
    const { data: current, error: photoError } = await admin
      .from('facility_menus')
      .select('photo_url')
      .eq('id', params.id)
      .eq('facility_id', ctx.facilityId)
      .maybeSingle();
    if (photoError) return serverError('admin-menus-photo-check', databaseDiagnostic(photoError), '/api/admin/menus/[id]');
    if (!current) return NextResponse.json({ error: 'メニューが見つかりません' }, { status: 404 });
    checkPhoto = true;
    expectedPhoto = current.photo_url;
    if (isNewStockImage(parsed.data.photo_url, current.photo_url)) {
      return NextResponse.json({ error: STOCK_IMAGE_ERROR }, { status: 400 });
    }
  }

  // 【2026年8月11日 恒久根治】空文字は「写真を外す」意思表示なので null に倒す。ただし
  // 【キーが送られてこなかったときは触らない】。以前は
  // `{ ...parsed.data, photo_url: parsed.data.photo_url || null }` と書いており、zod の optional は
  // 未指定キーを出力に含めないため、photo_url を含まない PATCH でも常に null が上書きされていた。
  // メニュー一覧の並び替え(↑↓)は `{ sort_order }` だけを送るため、【並び替えるだけでメニュー
  // 写真が無言で消えていた】。blog/[id] と同じ「未定義なら足さない」形に揃える。
  const updatePayload: FacilityMenuUpdate = { ...parsed.data };
  if (parsed.data.photo_url !== undefined) {
    updatePayload.photo_url = parsed.data.photo_url || null;
  }

  const data = await saveAdminMenu({ actorId: ctx.userId, facilityId: ctx.facilityId, menuId: params.id,
    values: updatePayload, checkPhoto, expectedPhoto });
  if (data instanceof NextResponse) return data;

  void writeAuditLog({
    userId: ctx.userId,
    facilityId: ctx.facilityId,
    action: 'update',
    tableName: 'facility_menus',
    recordId: params.id,
    newValues: parsed.data,
    ipAddress: ip,
  });

  return NextResponse.json({ menu: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-menus-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const ctx = await getAdminApiContext(request);
  if (ctx instanceof NextResponse) return ctx;

  const admin = createServiceRoleClient();

  const { data, error } = await admin.rpc('delete_admin_menu_atomic', {
    p_actor_id: ctx.userId, p_facility_id: ctx.facilityId, p_menu_id: params.id,
  });
  if (error) {
    if (error.code === '42501') return NextResponse.json({ error: '店舗の管理権限を確認してください' }, { status: 403 });
    if (error.code === 'P0002') return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
    return serverError('admin-menus-delete', databaseDiagnostic(error), '/api/admin/menus/[id]');
  }
  if (!data || data.length === 0) return NextResponse.json({ error: 'メニューが見つかりません' }, { status: 404 });
  if (data.length !== 1 || data[0].id !== params.id.toLowerCase() || data[0].facility_id !== ctx.facilityId.toLowerCase()) {
    return serverError('admin-menus-delete-receipt', new Error('MENU_RESULT_INVALID'), '/api/admin/menus/[id]');
  }
  if (data[0].outcome === 'last_menu') return NextResponse.json({ error: '公開中は最後のメニューを削除できません。先に施設を非公開にするか、別のメニューを追加してください。' }, { status: 400 });
  if (data[0].outcome !== 'deleted') return serverError('admin-menus-delete-receipt', new Error('MENU_RESULT_INVALID'), '/api/admin/menus/[id]');

  void writeAuditLog({
    userId: ctx.userId,
    facilityId: ctx.facilityId,
    action: 'delete',
    tableName: 'facility_menus',
    recordId: params.id,
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true });
}
