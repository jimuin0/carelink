import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
/**
 * 有料オプション（施設向け月額サブスク）の Stripe Checkout Session 作成
 * POST /api/options/checkout  body: { facilityId, optionKey }
 *
 * CareLink → 施設 への課金。決済完了は /api/payment/webhook の
 * checkout.session.completed（metadata.option_key あり）で facility_entitlements を
 * 自動有効化し、解約（customer.subscription.deleted）で自動無効化する。
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SITE_URL, UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { alertCaughtError } from '@/lib/alert';

export const dynamic = 'force-dynamic';

/** option_catalog.key の許容形式（英小文字・数字・アンダースコア） */
const OPTION_KEY_REGEX = /^[a-z0-9_]{1,64}$/;

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({ error: '決済機能が設定されていません' }, { status: 503 });
  }

  try {
    const ip = getClientIp(request);
    if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, 'mutation')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const { facilityId, optionKey } = await request.json().catch(() => ({}));
    if (!facilityId || !UUID_REGEX.test(facilityId) || !optionKey || !OPTION_KEY_REGEX.test(optionKey)) {
      return NextResponse.json({ error: 'パラメータが不正です' }, { status: 400 });
    }

    // 施設の owner/admin のみ購入可能（IDOR 防止）
    const { data: membership } = await supabase
      .from('facility_members')
      .select('role')
      .eq('facility_id', facilityId)
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ error: 'この施設の管理権限がありません' }, { status: 403 });
    }

    // カタログからサーバ側で価格決定（クライアント渡し価格は信用しない）
    const { data: option } = await supabase
      .from('option_catalog')
      .select('key, name, monthly_price, contact_only, is_active')
      .eq('key', optionKey)
      .maybeSingle();
    if (!option || !option.is_active) {
      return NextResponse.json({ error: 'オプションが見つかりません' }, { status: 404 });
    }
    if (option.contact_only) {
      return NextResponse.json({ error: 'このオプションはお申込み（個別対応）専用です' }, { status: 400 });
    }
    if (option.monthly_price <= 0) {
      return NextResponse.json({ error: '価格が未設定のため購入できません' }, { status: 400 });
    }

    // 既に利用中なら二重課金を防ぐ
    const { data: existing } = await supabase
      .from('facility_entitlements')
      .select('id')
      .eq('facility_id', facilityId)
      .eq('option_key', optionKey)
      .eq('status', 'active')
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'このオプションは既にご利用中です' }, { status: 400 });
    }

    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'jpy',
          product_data: {
            name: `CareLink オプション: ${option.name}`.slice(0, 200),
          },
          unit_amount: option.monthly_price,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${SITE_URL}/admin/settings?option=success`,
      cancel_url: `${SITE_URL}/admin/settings?option=cancelled`,
      metadata: {
        facility_id: facilityId,
        option_key: optionKey,
        user_id: user.id,
      },
      subscription_data: {
        metadata: {
          facility_id: facilityId,
          option_key: optionKey,
        },
      },
      locale: 'ja',
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[options/checkout] Error:', e);
    // catch して 500 を返すと instrumentation.ts の onRequestError に伝播せず Slack 通知が漏れるため明示通知。
    alertCaughtError('options-checkout', e, '/api/options/checkout');
    return NextResponse.json({ error: '決済セッションの作成に失敗しました' }, { status: 500 });
  }
}
