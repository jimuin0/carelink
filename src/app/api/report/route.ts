/**
 * 通報 API（v8.15）
 * POST /api/report
 * レビュー・施設・写真の不正報告を受け付ける
 *
 * 【2026年7月15日 要ログイン化】HPB 準拠・通報は会員前提（神原さん確定）。
 * 未認証は withRoute の requireAuth により 401 で遮断。IP 記録・レート制限（5回/分）・
 * 重複ブロック（23505）は維持し、user_id を通報者として記録する。
 */

import { NextResponse } from 'next/server';
import { mutationRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';
import { alertCaughtError } from '@/lib/alert';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const reportSchema = z.object({
  target_type: z.enum(['review', 'facility', 'photo']),
  target_id: z.string().uuid(),
  reason: z.enum(['spam', 'inappropriate', 'fake', 'offensive', 'other']),
  detail: z.string().max(500).optional(),
});

export const POST = withRoute(async (request, ctx) => {
  const ip = getClientIp(request);

  const body = await request.json().catch(() => null);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
  }

  // DB 書き込みは service_role に集約（anon INSERT ポリシー削除後も継続動作・RLS 依存排除）。
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('reports').insert({
    reporter_user_id: ctx.user!.id,
    reporter_ip: ip,
    target_type: parsed.data.target_type,
    target_id: parsed.data.target_id,
    reason: parsed.data.reason,
    detail: parsed.data.detail || null,
  });

  if (error) {
    // 重複通報
    if (error.code === '23505') {
      return NextResponse.json({ error: '既にこの内容を通報済みです' }, { status: 409 });
    }
    return NextResponse.json({ error: '通報に失敗しました' }, { status: 500 });
  }

  // 【監査H2】通報を moderation_queue へも連携し /admin/moderation で審査可能にする（旧実装は
  // reports へ INSERT するだけで、どの管理UIからも読まれず通報がブラックホール化していた）。
  // moderation_queue.content_type の CHECK は ('review','photo','qa_answer','blog_comment') で
  // 'facility' を許さない。UI（ReviewList）が送るのは review のみ・photo も有効。facility は
  // queue 非対応のため reports 台帳のみに残す（現状 facility 通報の UI 経路は存在しない）。
  // 連携失敗は通報自体（reports 記録済み）を 500 にせず監視通知に載せる（非ブロッキング）。
  const contentType: 'review' | 'photo' | null =
    parsed.data.target_type === 'review' ? 'review'
    : parsed.data.target_type === 'photo' ? 'photo'
    : null;
  if (contentType) {
    try {
      // 対象から facility_id を解決（review→facility_reviews / photo→facility_photos）。
      // 解決不能でも facility_id は nullable のため null で登録する。
      const sourceTable = contentType === 'review' ? 'facility_reviews' : 'facility_photos';
      const { data: target } = await supabase
        .from(sourceTable)
        .select('facility_id')
        .eq('id', parsed.data.target_id)
        .maybeSingle();
      const facilityId = (target as { facility_id: string | null } | null)?.facility_id ?? null;

      // 同一コンテンツの pending キューが既にあれば重複投入しない（複数通報者対策）。
      const { data: existingQueue } = await supabase
        .from('moderation_queue')
        .select('id')
        .eq('content_type', contentType)
        .eq('content_id', parsed.data.target_id)
        .eq('status', 'pending')
        .maybeSingle();

      if (!existingQueue) {
        const reportReason = parsed.data.detail
          ? `${parsed.data.reason}: ${parsed.data.detail}`
          : parsed.data.reason;
        const { error: mqError } = await supabase.from('moderation_queue').insert({
          content_type: contentType,
          content_id: parsed.data.target_id,
          facility_id: facilityId,
          reporter_id: ctx.user!.id,
          report_reason: reportReason,
          status: 'pending',
        });
        if (mqError) alertCaughtError('report-moderation-queue', mqError, '/api/report');
      }
    } catch (e) {
      alertCaughtError('report-moderation-queue', e, '/api/report');
    }
  }

  return NextResponse.json({ success: true });
}, {
  csrf: true,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'report' },
  sentryTag: 'report',
});
