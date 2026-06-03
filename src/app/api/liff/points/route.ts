/**
 * GET /api/liff/points
 * LIFFページ用: ユーザーのポイント残高と履歴を返す（LINE access tokenで認証）
 * Authorization: Bearer <LINE_access_token> ヘッダー必須
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';

export async function GET(req: NextRequest) {
  try {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'liff-points')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }

  // LINE access tokenでユーザーを認証
  const authHeader = req.headers.get('Authorization');
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
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

  // 履歴表示は直近50件。ただし残高は「直近50件の合計」ではなく全件 SUM（RPC）で算出する。
  // （取引が50件を超えるリピート顧客で残高が過少表示されるのを防ぐ・round6）
  const { data: logs } = await admin
    .from('user_points')
    .select('id, points, reason, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  const { data: balance } = await admin.rpc('get_user_points_balance', { p_user_id: userId });
  const total = balance ?? 0;

  return NextResponse.json({ logs: logs ?? [], total });
  } catch (e) {
    console.error('[liff/points] unexpected error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
