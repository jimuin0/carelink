import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import Stripe from 'stripe';
import { SITE_URL } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { alertCaughtError } from '@/lib/alert';

const PLAN_PRICES: Record<string, number> = {
  search_top: 9800,
  area_banner: 4900,
  category_top: 7800,
};

async function verifyFacilityMembership(userId: string, facilityId: string): Promise<boolean> {
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .maybeSingle();
  return data !== null;
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'featured-ads-get')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = req.nextUrl.searchParams.get('facility_id');
  if (!facilityId) return NextResponse.json({ error: 'facility_id required' }, { status: 400 });
  const isMember = await verifyFacilityMembership(user.id, facilityId);
  if (!isMember) return NextResponse.json({ error: 'No facility' }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data: slots, error: slotsErr } = await admin
    .from('featured_slots')
    .select('*')
    .eq('facility_id', facilityId)
    .order('starts_at', { ascending: false });

  if (slotsErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ slots: slots || [] });
}

export async function POST(req: NextRequest) {
  try {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'featured-ads')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { facility_id: bodyFacilityId, slot_type, area, business_type, starts_at, ends_at } = body;
  if (!bodyFacilityId) return NextResponse.json({ error: 'facility_id required' }, { status: 400 });
  const isMember = await verifyFacilityMembership(user.id, bodyFacilityId);
  if (!isMember) return NextResponse.json({ error: 'No facility' }, { status: 403 });
  const facilityId = bodyFacilityId;

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

  const { ua } = getRequestContext(req);
  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'create',
    tableName: 'featured_slots',
    recordId: slot.id,
    newValues: { slot_type, area: area || null, business_type: business_type || null, starts_at, ends_at },
    ipAddress: ip,
    userAgent: ua,
  });

  // Create Stripe Checkout session for payment
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    // 【恒久根治・金銭仕様確定 2026年7月16日】STRIPE_SECRET_KEY 未設定時に決済を経ずに
    // 広告枠を即アクティブ化していた。本番で env 設定ミスにより STRIPE_SECRET_KEY が
    // 抜けていると、これが「無料で広告枠が有効化される」抜け穴になる（金銭損失）。
    // 開発/デモ用途の即時有効化(Stripe未接続でも動作確認できる)自体は残すが、
    // 真の本番(VERCEL_ENV=production)でのみ fail-closed とし、決済なしの無料化を物理的に防ぐ。
    // NODE_ENV は Vercel の Preview デプロイでも 'production' になり Preview まで巻き込むため、
    // Preview を明確に区別できる VERCEL_ENV（alert.ts / instrumentation.ts と同じ env 判定源）で
    // 判定する。VERCEL_ENV は本番のみ 'production'・Preview は 'preview'・ローカルは undefined。
    if (process.env.VERCEL_ENV === 'production') {
      const err = new Error('STRIPE_SECRET_KEY is not set in production - refusing to activate featured slot without payment');
      console.error('[featured-ads] STRIPE_SECRET_KEY missing in production', { slotId: slot.id });
      alertCaughtError('featured-ads:stripe-key-missing', err, '/api/admin/featured-ads');
      return NextResponse.json({ error: '決済設定が未完了のため広告を有効化できません。運営にお問い合わせください。' }, { status: 500 });
    }
    // No Stripe configured (development/demo mode): activate immediately.
    const { error: activateErr } = await admin.from('featured_slots').update({ is_active: true }).eq('id', slot.id);
    if (activateErr) {
      console.error('[featured-ads] dev-mode activate failed', { slotId: slot.id, err: activateErr });
      return NextResponse.json({ error: 'スロットの有効化に失敗しました' }, { status: 500 });
    }
    return NextResponse.json({ slot, checkout_url: null }, { status: 201 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2026-06-24.dahlia' });
  const planLabels: Record<string, string> = {
    search_top: '検索結果トップ表示（月額）',
    area_banner: 'エリアページバナー（月額）',
    category_top: 'カテゴリトップ表示（月額）',
  };

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'jpy',
        unit_amount: PLAN_PRICES[slot_type],
        product_data: { name: planLabels[slot_type] || /* istanbul ignore next */ '広告プラン' },
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
