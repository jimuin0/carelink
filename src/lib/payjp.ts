/**
 * PAY.JP の REST API を fetch で直接呼ぶ薄いクライアント（2026年11月13日・点検 B2-1）。
 *
 * 公式 SDK（payjp パッケージ）は入れない。使うのは customer / card / plan / subscription / charge の
 * 数本だけで、Cloudflare Workers 上でも確実に動く fetch の方が依存と配信物を増やさずに済むため。
 *
 * 仕様の出典（2026年11月13日に確認）：https://docs.pay.jp/v1/api/ ・ /v1/subscription ・ /v1/webhook
 *   - ベース URL は https://api.pay.jp/v1 。認証は秘密鍵をユーザー名・パスワード空の HTTP Basic。
 *   - POST の本文は application/x-www-form-urlencoded。応答は JSON、失敗は {"error":{type,code,message,status}}。
 *   - webhook はヘッダー X-Payjp-Webhook-Token をダッシュボードの値と照合する（HMAC 署名は無い）。
 *     200 以外は 3 分おきに最大 3 回再送される。重複配信もあり得るので冪等に処理する。
 *
 * 【サーバ専用】秘密鍵を読むので、クライアントコンポーネントから import しない。
 */
import { timingSafeEqual } from 'crypto';

export const PAYJP_API_BASE = 'https://api.pay.jp/v1';

/** 広告枠（検索結果上位表示）の月額。税抜 9,800 円＋消費税 10%。画面の税込表示と PAY.JP のプラン金額を一致させる。 */
export const FEATURED_AD_PRICE_TAX_EXCLUDED = 9800;
export const FEATURED_AD_PRICE_TAX_INCLUDED = 10780;

/** 有料化の webhook が遅れても枠が一瞬消えないよう、課金期間の終わりに足す猶予。 */
export const FEATURED_AD_RENEWAL_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 15_000;

export class PayjpError extends Error {
  constructor(message: string, readonly status: number, readonly type?: string, readonly code?: string) {
    super(message);
    this.name = 'PayjpError';
  }
}

export type PayjpPlan = { id: string; amount: number; currency: string; interval: string };
export type PayjpSubscriptionStatus = 'active' | 'trial' | 'canceled' | 'paused';
export type PayjpSubscription = {
  id: string;
  status: PayjpSubscriptionStatus;
  customer: string;
  current_period_end: number | null;
  metadata: Record<string, string> | null;
};
export type PayjpCustomer = { id: string };
export type PayjpCharge = {
  id: string;
  amount: number;
  paid: boolean;
  captured: boolean;
  refunded: boolean;
  amount_refunded: number;
  metadata: Record<string, string> | null;
};

export async function payjpRequest<T>(method: 'GET' | 'POST', path: string, params?: Record<string, string>): Promise<T> {
  const key = process.env.PAYJP_SECRET_KEY;
  if (!key) throw new PayjpError('PAYJP_SECRET_KEY is not set', 0, 'configuration_error');
  const body = params ? new URLSearchParams(params).toString() : undefined;
  let res: Response;
  try {
    res = await fetch(`${PAYJP_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${key}:`)}`,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new PayjpError(`PAY.JP request failed: ${err instanceof Error ? err.message : 'unknown'}`, 0, 'network_error');
  }
  const json = await res.json().catch(() => null) as { error?: { message?: string; type?: string; code?: string } } | null;
  if (!res.ok) {
    throw new PayjpError(json?.error?.message ?? `PAY.JP HTTP ${res.status}`, res.status, json?.error?.type, json?.error?.code);
  }
  if (!json) throw new PayjpError('PAY.JP returned a non-JSON body', res.status, 'invalid_response');
  return json as T;
}

const seg = (id: string) => encodeURIComponent(id);

export function retrievePlan(planId: string): Promise<PayjpPlan> {
  return payjpRequest<PayjpPlan>('GET', `/plans/${seg(planId)}`);
}

/** カードのトークン（payjp.js が発行する tok_...）で customer を作る。カード番号はサーバーを通らない。 */
export function createCustomer(token: string, facilityId: string): Promise<PayjpCustomer> {
  return payjpRequest<PayjpCustomer>('POST', '/customers', {
    card: token,
    description: `CareLink facility ${facilityId}`,
    'metadata[facility_id]': facilityId,
  });
}

/** 既存の customer に新しいカードを足し、既定のカードにする。 */
export function addDefaultCard(customerId: string, token: string): Promise<{ id: string }> {
  return payjpRequest<{ id: string }>('POST', `/customers/${seg(customerId)}/cards`, { card: token, default: 'true' });
}

export function createSubscription(customerId: string, planId: string, metadata: Record<string, string>): Promise<PayjpSubscription> {
  const params: Record<string, string> = { customer: customerId, plan: planId };
  for (const [k, v] of Object.entries(metadata)) params[`metadata[${k}]`] = v;
  return payjpRequest<PayjpSubscription>('POST', '/subscriptions', params);
}

/** 期間末で解約する（即時削除ではない。期間末に subscription.deleted が届く）。 */
export function cancelSubscription(subscriptionId: string): Promise<PayjpSubscription> {
  return payjpRequest<PayjpSubscription>('POST', `/subscriptions/${seg(subscriptionId)}/cancel`);
}

/** 月額プランを作る（id を指定。同じ id は PAY.JP 側で重複不可）。 */
export function createPlan(planId: string, amount: number, name: string): Promise<PayjpPlan> {
  return payjpRequest<PayjpPlan>('POST', '/plans', {
    id: planId, amount: String(amount), currency: 'jpy', interval: 'month', name,
  });
}

/**
 * 1 回払いの支払いを作って即時に確定する（capture は既定の true）。
 * card には payjp.js が 3D セキュア付きで作ったトークン（createToken の three_d_secure: true）を渡す。
 * トークン側で認証が済むので、支払いの 3DS（tds_finish）は使わない（https://docs.pay.jp/v1/token-tds）。
 */
export function createCharge(token: string, amount: number, description: string, metadata: Record<string, string>): Promise<PayjpCharge> {
  const params: Record<string, string> = { card: token, amount: String(amount), currency: 'jpy', description };
  for (const [k, v] of Object.entries(metadata)) params[`metadata[${k}]`] = v;
  return payjpRequest<PayjpCharge>('POST', '/charges', params);
}

/** カードが使えなかった（利用者に直してもらう）失敗か。それ以外はこちら側・PAY.JP 側の障害として扱う。 */
export function isCardError(err: unknown): err is PayjpError {
  return err instanceof PayjpError && (err.type === 'card_error' || err.status === 402);
}

/** 指定した id のプランが無いか（PAY.JP は 404 を返す）。 */
export function isNotFound(err: unknown): boolean {
  return err instanceof PayjpError && err.status === 404;
}

/** プランが画面の表示（税込月額）と一致しているか。食い違えば販売しない。 */
export function planMatchesFeaturedPrice(plan: PayjpPlan): boolean {
  return plan.amount === FEATURED_AD_PRICE_TAX_INCLUDED && plan.currency === 'jpy' && plan.interval === 'month';
}

/** X-Payjp-Webhook-Token をダッシュボードの値と定数時間で照合する。未設定・欠落は常に不一致。 */
export function verifyPayjpWebhookToken(header: string | null): boolean {
  const expected = process.env.PAYJP_WEBHOOK_TOKEN;
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
