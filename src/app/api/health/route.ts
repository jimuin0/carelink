import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 外形監視用ヘルスチェック（多依存・並列・各依存タイムアウト 1.5s）
 *
 * Critical 依存（いずれか NG → status=503）:
 *   - Supabase DB（必須）
 *   - Upstash Redis（必須、rate-limit が依存）
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

async function probeUpstash(): Promise<DepResult> {
  return probe('upstash', async () => {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error('not configured');
    const redis = new Redis({ url, token });
    const r = await redis.ping();
    if (r !== 'PONG') throw new Error(`unexpected ping response: ${r}`);
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

  const [supabase, upstash, stripe, resend] = await Promise.all([
    probeSupabase(),
    probeUpstash(),
    probeStripe(),
    probeResend(),
  ]);

  const deps = { supabase, upstash, stripe, resend };

  // Critical: Supabase と Upstash が落ちたら 503
  const criticalOk = supabase.ok && upstash.ok;
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
