import { logCronRun } from '@/lib/cron-logger';
/**
 * 顧客セグメント分析 Cron（v8.2）
 * GET /api/cron/customer-segment
 * 週次でRFM分析を実行しcustomer_segmentsを更新
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { checkCronAuth } from '@/lib/cron-auth';
import { escSubject } from '@/lib/email';
import { fetchAllPaged } from '@/lib/paginate';

export const dynamic = 'force-dynamic';

function classifySegment(totalVisits: number, daysSinceLastVisit: number): string {
  if (totalVisits >= 5 && daysSinceLastVisit <= 30) return 'vip';
  if (totalVisits >= 2 && daysSinceLastVisit <= 60) return 'regular';
  if (totalVisits >= 2 && daysSinceLastVisit <= 120) return 'at_risk';
  if (totalVisits >= 2 && daysSinceLastVisit > 120) return 'lost';
  return 'new';
}

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  // 遅延初期化: モジュールスコープで createClient を呼ぶとビルド時の
  // page data 収集フェーズで env 未設定環境（Vercel preview 等）が
  // "supabaseUrl is required" で落ちるため、リクエスト時に生成する。
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startedAt = new Date();
  try {
    // 全公開施設を全件ページング取得（旧 .limit(200) は201施設目以降がRFM分析対象外だった・scale監査）
    const { rows: facilities } = await fetchAllPaged<{ id: string; name: string; slug: string }>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('facility_profiles')
          .select('id, name, slug')
          .eq('status', 'published')
          .range(offset, offset + limit - 1);
        return { data: data as { id: string; name: string; slug: string }[] | null, error };
      },
    );

    if (facilities.length === 0) {
      await logCronRun('customer-segment', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, status: 'ok', count: 0 });
    }

    // Build facility lookup map once (avoids per-facility re-fetch in email section)
    const facilityMap = new Map(facilities.map((f) => [f.id, f]));

    const now = new Date();
    const twoYearsAgo = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    let count = 0;
    let skipped = 0;

    for (const facility of facilities) {
      // 完了済み予約からメール別に集計（直近2年分・全件）。
      // 旧実装は .limit(2000) で繁忙施設の集計が頭打ち（RFM が途中のデータでしか算出されず不正確）だった。
      // fetchAllPaged で全件ページング取得し切り捨てを解消（同ファイルの施設取得と同じ方式・全ロジックはJS）。
      // RFM の顧客識別は email_canonical（Gmail 別名統合）で行い、同一人物の分裂を防ぐ（round: email_canonical 列方式）。
      type BookingRow = { email_canonical: string | null; customer_name: string | null; booking_date: string; total_price: number | null; status: string };
      const { rows: bookings } = await fetchAllPaged<BookingRow>(
        async (offset, limit) => {
          const { data, error } = await supabase
            .from('bookings')
            .select('email_canonical, customer_name, booking_date, total_price, status')
            .eq('facility_id', facility.id)
            .in('status', ['completed', 'confirmed'])
            .gte('booking_date', twoYearsAgo)
            .range(offset, offset + limit - 1);
          return { data: data as BookingRow[] | null, error };
        },
      );

      if (bookings.length === 0) { skipped++; continue; }

      // メール別に集計
      const customerMap = new Map<string, {
        name: string;
        firstVisit: string;
        lastVisit: string;
        visits: number;
        spent: number;
      }>();

      for (const b of bookings) {
        if (!b.email_canonical) continue;
        const existing = customerMap.get(b.email_canonical);
        if (existing) {
          existing.visits++;
          existing.spent += b.total_price || 0;
          if (b.booking_date < existing.firstVisit) existing.firstVisit = b.booking_date;
          if (b.booking_date > existing.lastVisit) existing.lastVisit = b.booking_date;
          if (b.customer_name) existing.name = b.customer_name;
        } else {
          customerMap.set(b.email_canonical, {
            name: b.customer_name || '',
            firstVisit: b.booking_date,
            lastVisit: b.booking_date,
            visits: 1,
            spent: b.total_price || 0,
          });
        }
      }

      const entries = Array.from(customerMap.entries());

      // Batch upsert to customer_segments (up to 500 per call to avoid payload limits)
      const upsertRows = entries.map(([email, data]) => {
        const daysSince = Math.floor((now.getTime() - new Date(data.lastVisit).getTime()) / (1000 * 60 * 60 * 24));
        return {
          facility_id: facility.id,
          customer_email: email,
          customer_name: data.name,
          first_visit_date: data.firstVisit,
          last_visit_date: data.lastVisit,
          total_visits: data.visits,
          total_spent: data.spent,
          segment: classifySegment(data.visits, daysSince),
          updated_at: now.toISOString(),
        };
      });

      const CHUNK = 500;
      for (let i = 0; i < upsertRows.length; i += CHUNK) {
        const { error: upsertErr } = await supabase
          .from('customer_segments')
          .upsert(upsertRows.slice(i, i + CHUNK), { onConflict: 'facility_id,customer_email' });
        if (upsertErr) {
          console.error('[customer-segment] upsert chunk failed', { facilityId: facility.id, chunkStart: i, err: upsertErr });
        }
      }

      // 離脱リスク顧客に自動フォローメール
      if (process.env.RESEND_API_KEY) {
        const facilityInfo = facilityMap.get(facility.id);
        // facilityMap is built from the same facilities array, so facilityInfo is always defined.
        // The false branch is structurally unreachable.
        /* istanbul ignore next */
        if (facilityInfo) {
          const resend = new Resend(process.env.RESEND_API_KEY);

          // Collect at-risk candidates first
          const atRiskCandidates = entries.filter(([, data]) => {
            const daysSince = Math.floor((now.getTime() - new Date(data.lastVisit).getTime()) / (1000 * 60 * 60 * 24));
            return classifySegment(data.visits, daysSince) === 'at_risk' && daysSince >= 60 && daysSince <= 65;
          });

          if (atRiskCandidates.length > 0) {
            const atRiskEmails = atRiskCandidates.map(([email]) => email);

            // Batch check for existing coupons (one query instead of N)
            const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const { data: existingCoupons } = await supabase
              .from('user_coupon_codes')
              .select('email')
              .eq('facility_id', facility.id)
              .in('email', atRiskEmails)
              .eq('reason', 'at_risk')
              .gte('created_at', cutoff30d);

            const alreadySentEmails = new Set((existingCoupons || []).map((c) => c.email));

            for (const [email, data] of atRiskCandidates) {
              if (alreadySentEmails.has(email)) continue;

              const daysSince = Math.floor((now.getTime() - new Date(data.lastVisit).getTime()) / (1000 * 60 * 60 * 24));
              const couponCode = `BACK${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
              const validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

              const { error: couponErr } = await supabase.from('user_coupon_codes').insert({
                facility_id: facility.id,
                email,
                code: couponCode,
                discount_type: 'fixed',
                discount_value: 500,
                reason: 'at_risk',
                valid_until: validUntil,
              });
              if (couponErr) {
                console.error('[customer-segment] coupon insert failed, skipping email', { email: String(email).replace(/(.).*@/, '$1***@'), error: couponErr });
                continue;
              }

              await resend.emails.send({
                from: process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>',
                to: email,
                subject: escSubject(`【${facilityInfo.name}】お久しぶりです！特別クーポンをお届けします`),
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
              }).catch((err) => console.error('[customer-segment] email send failed', { email: String(email).replace(/(.).*@/, '$1***@'), err }));
            }
          }
        }
      }

      count++;
    }

    await logCronRun('customer-segment', 'success', startedAt, { processed: count, skipped });
    return NextResponse.json({ processed: count, skipped });
  } catch (e) {
    console.error('[customer-segment] Error:', e);
    await logCronRun('customer-segment', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
