/**
 * 顧客セグメント分析 Cron（v8.1）
 * GET /api/cron/customer-segment
 * 週次でRFM分析を実行しcustomer_segmentsを更新
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function classifySegment(totalVisits: number, daysSinceLastVisit: number): string {
  if (totalVisits >= 5 && daysSinceLastVisit <= 30) return 'vip';
  if (totalVisits >= 2 && daysSinceLastVisit <= 60) return 'regular';
  if (totalVisits >= 2 && daysSinceLastVisit <= 120) return 'at_risk';
  if (totalVisits >= 2 && daysSinceLastVisit > 120) return 'lost';
  return 'new';
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data: facilities } = await supabase
      .from('facility_profiles')
      .select('id')
      .eq('status', 'published');

    if (!facilities) return NextResponse.json({ status: 'ok', count: 0 });

    const now = new Date();
    let count = 0;

    for (const facility of facilities) {
      // 完了済み予約からメール別に集計
      const { data: bookings } = await supabase
        .from('bookings')
        .select('email, customer_name, booking_date, total_price, status')
        .eq('facility_id', facility.id)
        .in('status', ['completed', 'confirmed']);

      if (!bookings || bookings.length === 0) continue;

      // メール別に集計
      const customerMap = new Map<string, {
        name: string;
        firstVisit: string;
        lastVisit: string;
        visits: number;
        spent: number;
      }>();

      for (const b of bookings) {
        if (!b.email) continue;
        const existing = customerMap.get(b.email);
        if (existing) {
          existing.visits++;
          existing.spent += b.total_price || 0;
          if (b.booking_date < existing.firstVisit) existing.firstVisit = b.booking_date;
          if (b.booking_date > existing.lastVisit) existing.lastVisit = b.booking_date;
          if (b.customer_name) existing.name = b.customer_name;
        } else {
          customerMap.set(b.email, {
            name: b.customer_name || '',
            firstVisit: b.booking_date,
            lastVisit: b.booking_date,
            visits: 1,
            spent: b.total_price || 0,
          });
        }
      }

      // セグメント分類してupsert
      const entries = Array.from(customerMap.entries());
      for (const [email, data] of entries) {
        const daysSince = Math.floor((now.getTime() - new Date(data.lastVisit).getTime()) / (1000 * 60 * 60 * 24));
        const segment = classifySegment(data.visits, daysSince);

        await supabase
          .from('customer_segments')
          .upsert({
            facility_id: facility.id,
            customer_email: email,
            customer_name: data.name,
            first_visit_date: data.firstVisit,
            last_visit_date: data.lastVisit,
            total_visits: data.visits,
            total_spent: data.spent,
            segment,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'facility_id,customer_email' });
      }

      count++;
    }

    return NextResponse.json({ status: 'ok', facilities: count });
  } catch (e) {
    console.error('[customer-segment] Error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
