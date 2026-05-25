import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 外形監視用ヘルスチェック（多依存・並列・各依存タイムアウト 1.5s）
 *
 * Critical 依存（いずれか NG → status=503）:
 *   - Supabase DB（必須）
 *   - Supabase RPC check_rate_limit（必須、rate-limit が依存）
 *
 * Degraded 依存（NG でも 200 を維持、deps に状態のみ報告）:
 *   - Stripe / Resend / Slack（決済・通知系、即時致命ではないがダッシュボード可視化）
 *
 * UptimeRobot等の外形監視はこのエンドポイントを 60s 間隔で監視し、
 * ステータス + JSON body の deps を見て障害種別を切り分ける。
 */

const DEP_TIMEOUT_MS = 1500;

type DepResult = { ok: boolean; elapsed_ms: number; error?: string };

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms)),
  ]);
}

async function probe(label: string, fn: () => Promise<void>): Promise<DepResult> {
  const start = Date.now();
  try {
    await withTimeout(fn(), DEP_TIMEOUT_MS, label);
    return { ok: true, elapsed_ms: Date.now() - start };
  } catch (e) {
    return {
      ok: false,
      elapsed_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function probeSupabase(): Promise<DepResult> {
  return probe('supabase', async () => {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase
      .from('facility_profiles')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    if (error) throw new Error(error.message);
  });
}

async function probeRateLimit(): Promise<DepResult> {
  return probe('rate_limit', async () => {
    // Supabase RPC check_rate_limit を実呼びして実装の生存確認
    // 大きな limit で 1 回呼んでも実害なし（バケットに 1 行作るだけ、1h で自動削除）
    const supabase = createServiceRoleClient();
    const { error } = await supabase.rpc('check_rate_limit', {
      p_key: 'rl:health-probe:127.0.0.1',
      p_limit: 999999,
      p_window_ms: 60000,
    });
    if (error) throw new Error(error.message);
  });
}

async function probeStripe(): Promise<DepResult> {
  return probe('stripe', async () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('not configured');
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(DEP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
}

async function probeResend(): Promise<DepResult> {
  return probe('resend', async () => {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('not configured');
    const res = await fetch('https://api.resend.com/domains', {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(DEP_TIMEOUT_MS),
    });
    // 401 は credential 異常で NG、200/404 は鍵自体は有効
    if (res.status === 401) throw new Error('unauthorized');
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
  });
}

export async function GET() {
  const start = Date.now();

  const [supabase, rate_limit, stripe, resend] = await Promise.all([
    probeSupabase(),
    probeRateLimit(),
    probeStripe(),
    probeResend(),
  ]);

  const deps = { supabase, rate_limit, stripe, resend };

  // Critical: Supabase DB と rate_limit RPC が落ちたら 503
  const criticalOk = supabase.ok && rate_limit.ok;
  // Degraded: Stripe/Resend は warn のみ
  const degraded = !stripe.ok || !resend.ok;

  const status = criticalOk ? (degraded ? 'degraded' : 'healthy') : 'unhealthy';
  const httpStatus = criticalOk ? 200 : 503;

  return NextResponse.json(
    {
      status,
      elapsed_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
      deps,
    },
    { status: httpStatus }
  );
}
