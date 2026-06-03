import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import Stripe from 'stripe';
import { SITE_URL } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getPayjp } from '@/lib/payjp';

const PLAN_PRICES: Record<string, number> = {
  search_top: 9800,
  area_banner: 4900,
  category_top: 7800,
};

const PLAN_LABELS: Record<string, string> = {
  search_top: '検索結果トップ表示（月額）',
  area_banner: 'エリアページバナー（月額）',
  category_top: 'カテゴリトップ表示（月額）',
};

// PAY.JP のカードトークンは 'tok_' + 英数字。
const PAYJP_TOKEN_RE = /^tok_[A-Za-z0-9]+$/;

async function getFacilityId(userId: string) {
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .in('role', ['owner', 'admin'])
    .limit(1)
    .single();
  return data?.facility_id;
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'featured-ads-get')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await getFacilityId(user.id);
  if (!facilityId) return NextResponse.json({ error: 'No facility' }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data: slots } = await admin
    .from('featured_slots')
    .select('*')
    .eq('facility_id', facilityId)
    .order('starts_at', { ascending: false });

  return NextResponse.json({ slots: slots || [] });
}

export async function POST(req: NextRequest) {
  try {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'featured-ads')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await getFacilityId(user.id);
  if (!facilityId) return NextResponse.json({ error: 'No facility' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { slot_type, area, business_type, starts_at, ends_at } = body;

  if (!slot_type || !starts_at || !ends_at) {
    return NextResponse.json({ error: 'slot_type, starts_at, ends_at required' }, { status: 400 });
  }

  const VALID_TYPES = ['search_top', 'area_banner', 'category_top'];
  if (!VALID_TYPES.includes(slot_type)) {
    return NextResponse.json({ error: 'Invalid slot_type' }, { status: 400 });
  }

  // Validate dates: must be parseable, ends_at > starts_at, and not more than 2 years out
  const startsDate = new Date(starts_at);
  const endsDate = new Date(ends_at);
  const maxAllowed = new Date();
  maxAllowed.setFullYear(maxAllowed.getFullYear() + 2);
  if (isNaN(startsDate.getTime()) || isNaN(endsDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }
  if (endsDate <= startsDate) {
    return NextResponse.json({ error: 'ends_at must be after starts_at' }, { status: 400 });
  }
  if (endsDate > maxAllowed) {
    return NextResponse.json({ error: 'ends_at is too far in the future' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: slot, error } = await admin
    .from('featured_slots')
    .insert({
      facility_id: facilityId,
      slot_type,
      area: area || null,
      business_type: business_type || null,
      starts_at: new Date(starts_at).toISOString(),
      ends_at: new Date(ends_at).toISOString(),
      budget_yen: PLAN_PRICES[slot_type] || /* istanbul ignore next */ 0,
      is_active: false, // becomes active after payment
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  // PAY.JP 同期課金（token があれば優先。Stripe からの移行 Phase 3）。
  // クライアントがカードをトークン化して token を送る → 即時課金 → 成立で is_active=true を同期確定。
  // 課金失敗時は作成済みスロットを削除して孤児を残さない。
  const payjp = getPayjp();
  if (payjp && typeof body.token === 'string') {
    if (body.token.length > 100 || !PAYJP_TOKEN_RE.test(body.token)) {
      await admin.from('featured_slots').delete().eq('id', slot.id);
      return NextResponse.json({ error: 'カードトークンが不正です' }, { status: 400 });
    }
    try {
      const charge = await payjp.charges.create({
        amount: PLAN_PRICES[slot_type],
        currency: 'jpy',
        card: body.token,
        capture: true,
        description: PLAN_LABELS[slot_type] || /* istanbul ignore next */ '広告プラン',
        metadata: { slot_id: slot.id, facility_id: facilityId },
      });
      if (!charge.paid || !charge.captured) {
        await admin.from('featured_slots').delete().eq('id', slot.id);
        return NextResponse.json({ error: '決済が完了しませんでした' }, { status: 402 });
      }
      const { error: activateErr } = await admin.from('featured_slots').update({ is_active: true }).eq('id', slot.id);
      if (activateErr) {
        // 課金成立済み。返金は運用対応とし、孤児スロットは残さず 500 を返してログに残す。
        console.error('[featured-ads] payjp charged but activate failed — needs manual reconcile', { slotId: slot.id, chargeId: charge.id, err: activateErr.message });
        return NextResponse.json({ error: '決済は完了しましたが有効化に失敗しました。サポートにお問い合わせください。', chargeId: charge.id }, { status: 500 });
      }
      return NextResponse.json({ slot: { ...slot, is_active: true }, paid: true, chargeId: charge.id }, { status: 201 });
    } catch (chargeErr) {
      await admin.from('featured_slots').delete().eq('id', slot.id);
      console.error('[featured-ads] payjp charge failed', { slotId: slot.id, err: chargeErr instanceof Error ? chargeErr.message : String(chargeErr) });
      return NextResponse.json({ error: '決済に失敗しました。カード情報をご確認ください。' }, { status: 402 });
    }
  }

  // Create Stripe Checkout session for payment（移行期フォールバック）
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    // No Stripe configured: activate immediately (development/demo mode)
    const { error: activateErr } = await admin.from('featured_slots').update({ is_active: true }).eq('id', slot.id);
    if (activateErr) {
      console.error('[featured-ads] dev-mode activate failed', { slotId: slot.id, err: activateErr });
      return NextResponse.json({ error: 'スロットの有効化に失敗しました' }, { status: 500 });
    }
    return NextResponse.json({ slot, checkout_url: null }, { status: 201 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'jpy',
        unit_amount: PLAN_PRICES[slot_type],
        product_data: { name: PLAN_LABELS[slot_type] || /* istanbul ignore next */ '広告プラン' },
      },
    }],
    success_url: `${SITE_URL}/admin/featured-ads?payment=success&slot=${slot.id}`,
    cancel_url: `${SITE_URL}/admin/featured-ads?payment=cancel`,
    metadata: { slot_id: slot.id, facility_id: facilityId },
  });

  return NextResponse.json({ slot, checkout_url: session.url }, { status: 201 });
  } catch (e) {
    console.error('[featured-ads] POST error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
