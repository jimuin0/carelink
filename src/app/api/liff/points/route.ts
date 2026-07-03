/**
 * GET /api/liff/points
 * LIFFページ用: ユーザーのポイント残高と履歴を返す（LINE access tokenで認証）
 * Authorization: Bearer <LINE_access_token> ヘッダー必須
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { verifyLineAccessToken } from '@/lib/line';
import { alertCaughtError } from '@/lib/alert';

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

  // ★ audience(channel)検証: /v2/profile は発行元チャネル(client_id)を検証しないため、
  //   oauth2/v2.1/verify で自社チャネルID一致を必須化する（他チャネル発行トークンでの
  //   line_user_id 詐称＝他人ポイント履歴のIDOR閲覧を遮断）。fail-closed。
  const tokenCheck = await verifyLineAccessToken(accessToken);
  if (!tokenCheck.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // LINE Profile APIでトークンを検証
  const lineRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!lineRes.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const lineProfile = await lineRes.json() as { userId: string };

  const admin = createServiceRoleClient();

  // line_user_idからprofilesのuser_idを取得
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('line_user_id', lineProfile.userId)
    .single();
  if (!profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  const userId = profile.id;

  // 表示用の履歴は直近50件に制限する（一覧描画コストの抑制）。
  const { data: logs } = await admin
    .from('user_points')
    .select('id, points, reason, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  // 残高(total)は【全履歴の合計】で算出する。直近50件だけの合計を残高にすると、履歴が51件以上ある
  // ユーザーで残高が実際とずれ、Web版マイページ(mypage/points は .limit なしで全件合計)と食い違う。
  // user_points は残高カラムを持たない純台帳のため、全 points 列を取得して合算する
  // （booking/route.ts の残高算出と同じ全件合計方式に統一）。
  const { data: allPoints } = await admin
    .from('user_points')
    .select('points')
    .eq('user_id', userId);
  const total = (allPoints ?? []).reduce((sum, row) => sum + (row.points ?? 0), 0);

  return NextResponse.json({ logs: logs ?? [], total });
  } catch (e) {
    console.error('[liff/points] unexpected error:', e);
    alertCaughtError('liff-points', e, '/api/liff/points');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
