/**
 * GET /api/liff/points
 * LIFFページ用: ユーザーのポイント残高と履歴を返す（LINE access tokenで認証）
 * Authorization: Bearer <LINE_access_token> ヘッダー必須
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { fetchVerifiedLiffProfile } from '@/lib/liff-profile';
import { resolveVerifiedLineOwner } from '@/lib/verified-line-owner';
import { serverError } from '@/lib/with-route';

export async function GET(req: NextRequest) {
  try {
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 30, 60_000, 'liff-points')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }

  // LINE access tokenでユーザーを認証
  const authHeader = req.headers.get('Authorization');
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const identity = await fetchVerifiedLiffProfile(accessToken);
  if (!identity.ok) return NextResponse.json({ error: identity.status === 401 ? 'Unauthorized' : identity.error }, { status: identity.status });

  const admin = createServiceRoleClient();

  const userId = await resolveVerifiedLineOwner(admin, identity.lineUserId);
  if (!userId) return NextResponse.json({ error: 'LINE の連携を再確認してください。本人のアカウントでログインして LINE を連携してください。', code: 'LINE_LINK_REQUIRED' }, { status: 404 });

  // 表示用の履歴は直近50件に制限する（一覧描画コストの抑制）。
  // 【2026年7月10日 恒久根治】以下2クエリとも error を検査せず null→空配列/0にフォールバック
  // していたため、DB障害時も「ポイント履歴なし・残高0」と偽装表示していた（実際に残高がある
  // 客が「ポイントが消えた」と誤認する金銭的信頼性リスク）。error を検査し、真の失敗は500で
  // 可視化する（残高を誤って0と表示するより、エラーとして知らせる方が安全）。
  const { data: logs, error: logsError } = await admin
    .from('user_points')
    .select('id, points, reason, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (logsError) {
    return serverError('liff-points-logs', logsError, '/api/liff/points', 'Internal Server Error');
  }

  // 残高(total)は【全履歴の合計】で算出する。直近50件だけの合計を残高にすると、履歴が51件以上ある
  // ユーザーで残高が実際とずれ、Web版マイページ(mypage/points は .limit なしで全件合計)と食い違う。
  // user_points は残高カラムを持たない純台帳のため、全 points 列を取得して合算する
  // （booking/route.ts の残高算出と同じ全件合計方式に統一）。
  const { data: allPoints, error: allPointsError } = await admin
    .from('user_points')
    .select('points')
    .eq('user_id', userId);

  if (allPointsError) {
    return serverError('liff-points-total', allPointsError, '/api/liff/points', 'Internal Server Error');
  }

  const total = (allPoints ?? []).reduce((sum, row) => sum + (row.points ?? 0), 0);

  return NextResponse.json({ logs: logs ?? [], total });
  } catch (e) {
    return serverError('liff-points', e, '/api/liff/points', 'Internal Server Error');
  }
}
