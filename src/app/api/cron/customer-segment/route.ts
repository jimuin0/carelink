import { logCronRun } from '@/lib/cron-logger';
/**
 * 顧客セグメント分析 Cron（v8.1）
 * GET /api/cron/customer-segment
 * 週次でRFM分析を実行しcustomer_segmentsを更新
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

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

      // 離脱リスク顧客に自動フォローメール
      if (process.env.RESEND_API_KEY) {
        const { data: facilityInfo } = await supabase
          .from('facility_profiles')
          .select('name, slug')
          .eq('id', facility.id)
          .maybeSingle();

        if (facilityInfo) {
          const resend = new Resend(process.env.RESEND_API_KEY);
          for (const [email, data] of entries) {
            const daysSince = Math.floor((now.getTime() - new Date(data.lastVisit).getTime()) / (1000 * 60 * 60 * 24));
            const segment = classifySegment(data.visits, daysSince);

            if (segment === 'at_risk' && daysSince >= 60 && daysSince <= 65) {
              // 60-65日の間のみ送信（重複防止）
              // 個別クーポンコードを生成（500円引き、30日有効）
              const couponCode = `BACK${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
              const validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

              // 重複送信チェック（既存クーポンがあればスキップ）
              const { data: existingCoupon } = await supabase
                .from('user_coupon_codes')
                .select('id')
                .eq('facility_id', facility.id)
                .eq('email', email)
                .eq('reason', 'at_risk')
                .gte('created_at', new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString())
                .maybeSingle();

              if (existingCoupon) continue;

              await supabase.from('user_coupon_codes').insert({
                facility_id: facility.id,
                email,
                code: couponCode,
                discount_type: 'fixed',
                discount_value: 500,
                reason: 'at_risk',
                valid_until: validUntil,
              }).then(() => null, () => null);

              await resend.emails.send({
                from: process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>',
                to: email,
                subject: `【${facilityInfo.name}】お久しぶりです！特別クーポンをお届けします`,
                html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                  <p>${data.name || 'お客'}様</p>
                  <p>前回のご来店から${daysSince}日が経ちました。お体の調子はいかがですか？</p>
                  <p>${facilityInfo.name}からお帰りいただきたく、<strong>特別割引クーポン</strong>をご用意いたしました。</p>
                  <div style="background:#f0f9ff;border:2px solid #0ea5e9;border-radius:12px;padding:20px;text-align:center;margin:20px 0;">
                    <p style="font-size:12px;color:#64748b;margin:0 0 8px;">クーポンコード</p>
                    <p style="font-size:28px;font-weight:700;letter-spacing:0.1em;color:#0284c7;margin:0;">${couponCode}</p>
                    <p style="font-size:14px;color:#475569;margin:8px 0 0;">500円引き｜有効期限: ${validUntil}</p>
                  </div>
                  <p style="text-align:center;">
                    <a href="https://carelink-jp.com/facility/${facilityInfo.slug}" style="display:inline-block;padding:12px 24px;background:#0284C7;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">ご予約・クーポン利用はこちら</a>
                  </p>
                  <p style="font-size:12px;color:#94a3b8;margin-top:24px;">このメールは CareLink から自動送信されています。</p>
                </div>`,
              }).catch(() => {});
            }
          }
        }
      }

      count++;
    }

    return NextResponse.json({ status: 'ok', facilities: count });
  } catch (e) {
    console.error('[customer-segment] Error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
