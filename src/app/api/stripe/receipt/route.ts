/**
 * 領収書生成
 * GET /api/stripe/receipt?session_id=xxx
 * — HTML → ブラウザで印刷可能な領収書
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { buildReceiptHtml } from '@/lib/receipt-html';

export async function GET(request: NextRequest) {
  try {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'stripe-receipt')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sessionId = request.nextUrl.searchParams.get('session_id');
  // Stripe Checkout Session IDs start with "cs_" and are at most ~200 chars
  if (!sessionId || sessionId.length > 200 || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  const { data: session } = await admin
    .from('stripe_sessions')
    .select('*, facility_profiles(name, address, phone, postal_code, prefecture, city)')
    .eq('stripe_session_id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (!session) return NextResponse.json({ error: '領収書が見つかりません' }, { status: 404 });
  if (session.status !== 'paid') return NextResponse.json({ error: '未払いの予約には領収書を発行できません' }, { status: 400 });

  const facility = Array.isArray(session.facility_profiles) ? session.facility_profiles[0] : session.facility_profiles;
  const issuedDate = new Date(session.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const receiptNo = `CL-${session.id.slice(0, 8).toUpperCase()}`;

  const html = buildReceiptHtml({
    receiptNo,
    issuedDate,
    amount: session.amount,
    itemLabel: session.payment_type === 'deposit' ? 'デポジット（予約保証金）' : '施術料金',
    facility,
    paymentId: session.stripe_session_id,
  });

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
  } catch (e) {
    console.error('[stripe/receipt] unexpected error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
