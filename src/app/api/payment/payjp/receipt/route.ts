/**
 * PAY.JP 領収書生成（Stripe からの移行 Phase 4a）
 * GET /api/payment/payjp/receipt?bookingId=xxx
 * — PAY.JP 同期課金（payment_status='paid' / payjp_charge_id）から HTML 領収書を生成。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX } from '@/lib/constants';
import { buildReceiptHtml } from '@/lib/receipt-html';

export async function GET(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (inMemoryRateLimit(ip, 20, 60_000, 'payjp-receipt')) {
      return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
    }
    const supabase = await createServerSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const bookingId = request.nextUrl.searchParams.get('bookingId');
    if (!bookingId || !UUID_REGEX.test(bookingId)) {
      return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
    }

    const admin = createServiceRoleClient();
    const { data: booking } = await admin
      .from('bookings')
      .select('id, user_id, paid_amount, total_price, payment_status, payjp_charge_id, created_at, facility_profiles(name, address, phone, postal_code, prefecture, city)')
      .eq('id', bookingId)
      .eq('user_id', user.id)
      .single();

    if (!booking) return NextResponse.json({ error: '領収書が見つかりません' }, { status: 404 });
    if (booking.payment_status !== 'paid' || !booking.payjp_charge_id) {
      return NextResponse.json({ error: '未払いの予約には領収書を発行できません' }, { status: 400 });
    }

    const facility = Array.isArray(booking.facility_profiles) ? booking.facility_profiles[0] : booking.facility_profiles;
    const amount = booking.paid_amount ?? booking.total_price ?? 0;
    const issuedDate = new Date(booking.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

    const html = buildReceiptHtml({
      receiptNo: `CL-${String(booking.id).slice(0, 8).toUpperCase()}`,
      issuedDate,
      amount,
      itemLabel: '施術料金',
      facility,
      paymentId: booking.payjp_charge_id,
    });

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    console.error('[payment/payjp/receipt] unexpected error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
