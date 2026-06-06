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

type DepResult = { ok: boolean; elapsed_ms: number; error?: string; retried?: boolean };

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  // タイマーを必ず clearTimeout する（race で p が勝った場合も timeout が発火した場合も）。
  // 未 clear だと plain setTimeout（unref されない）が ms 間 event loop を生かし続け、
  // テストでは mock 済み deps が即解決するため毎回 1500ms のタイマーが残留 →
  // jest worker が teardown 猶予内に exit できず "failed to exit gracefully" を招いていた。
  // 本番でも /health 成功毎にタイマーが残る実リークであり、症状抑止でなく発生源を断つ。
  // timer は Promise executor（同期実行）内で必ず代入されるため definite assignment(!)。
  // clearTimeout は無条件呼び出し（発火済みタイマーへの呼び出しも no-op）→ 分岐を増やさず L3 100% を維持。
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
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

// Critical 依存は「単発の一過性レイテンシ・スパイク（cold start / 瞬間的な高負荷 / 一時的なネットワーク遅延）」を
// 依存の"停止"と誤判定しないよう、失敗時に1回だけ即再試行する（真の予防：発症前）。
// 2回目の結果を採用＝一過性スパイクなら成功して吸収、持続的な実停止なら2回とも失敗して ok:false → 503。
// これにより「実際には稼働しているのに単発の遅延で 503 ページ通知」を構造的に無くす。
async function criticalProbe(label: string, fn: () => Promise<void>): Promise<DepResult> {
  const first = await probe(label, fn);
  if (first.ok) return first;
  const retry = await probe(label, fn);
  return { ...retry, retried: true };
}

async function probeSupabase(): Promise<DepResult> {
  return criticalProbe('supabase', async () => {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase
      .from('facility_profiles')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    if (error) throw new Error(error.message);
  });
}

async function probeRateLimit(): Promise<DepResult> {
  return criticalProbe('rate_limit', async () => {
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
