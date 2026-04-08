import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 外形監視用ヘルスチェック
 * - DB接続を最小コストで確認（COUNT 1）
 * - 200 = 全システム健全
 * - 503 = DB接続失敗（即アラート対象）
 *
 * UptimeRobot等の外形監視はこのエンドポイントを5分間隔で監視
 */
export async function GET() {
  const start = Date.now();

  try {
    const supabase = createServerSupabaseClient();
    // 最小コストでDB疎通確認
    const { error } = await supabase
      .from('facility_profiles')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    const elapsed = Date.now() - start;

    if (error) {
      return NextResponse.json(
        {
          status: 'unhealthy',
          db: 'error',
          message: error.message,
          elapsed_ms: elapsed,
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      status: 'healthy',
      db: 'ok',
      elapsed_ms: elapsed,
      timestamp: new Date().toISOString(),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    });
  } catch (e) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        db: 'exception',
        message: e instanceof Error ? e.message : 'unknown',
        elapsed_ms: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
