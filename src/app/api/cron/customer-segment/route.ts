import { logCronRun, cronError } from '@/lib/cron-logger';
/**
 * 顧客セグメント分析 Cron（v8.2）
 * GET /api/cron/customer-segment
 * 週次でRFM分析を実行しcustomer_segmentsを更新
 *
 * 🔴 この cron は【顧客へメールを送らない】（2026年10月22日 神原さん決定）。
 * 以前は離脱リスク（at_risk）の客へ「500円引きクーポンコード（BACK…）」を店舗名義で自動送信していたが、
 * そのコードは予約でも店頭でも使えず、店舗側も確認できなかった（使えない約束を店舗の名前でしていた）。
 * さらに配信停止（マイページの「お知らせメール」OFF）も効かなかった。送信経路ごと撤去し、
 * 分類（customer_segments の更新）だけを続けている。
 * 再び送る場合は、コードを使える仕組み・店舗の同意・配信停止の確認を揃えてから。
 * src/__tests__/at-risk-coupon-email-stopped.test.ts が再配線を CI で止める。
 *
 * 【お客様の識別】メールがあればメール（canonical）、メールの無い電話・来店受付の予約は電話番号
 * （'tel:' ＋ 数字・customerIdentityKey）。顧客一覧（/admin/customers）と同じキーなので、
 * 電話番号だけで登録したお客様にもセグメントが付く。
 *
 * 【施設ごとに丸ごと置き換える】今回の集計に現れなかったお客様の行は消す（2026年10月23日）。
 * 以前は upsert だけで消さなかったため、「完了」を「無断キャンセル」に訂正して来店 0 回になったお客様に
 * 「新規」と累計利用額が残り続け、分析画面の総顧客数・リピート率の分母にも数えられていた。
 * 今回の行は updated_at を実行開始時刻にそろえて書くので、それより古い行＝今回現れなかった行を消す。
 * 予約の取得や保存に失敗した施設では消さない（失敗を「0 件」と取り違えて全行を消さないため）。
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkCronAuth } from '@/lib/cron-auth';
import { fetchAllPaged } from '@/lib/paginate';
import { isMissingColumnError, type DbError } from '@/lib/db-fallback';
import { customerIdentityKey } from '@/lib/customer-identity';

export const dynamic = 'force-dynamic';
// 既定の低い上限を上書きし、下の時間予算ガードが確実に発火する既知の上限を与える。
export const maxDuration = 60;
// 施設ループの実時間予算。maxDuration(60s) 未満に設定し、超えたら残りを翌 run へ繰延。
const SEGMENT_BUDGET_MS = 50 * 1000;

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
    // RFM 分類に要るのは施設 ID だけ（施設名・slug はメール本文用だった＝送信撤去で不要）。
    const { rows: facilities, error: facilitiesError } = await fetchAllPaged<{ id: string }>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('facility_profiles')
          .select('id')
          .eq('status', 'published')
          .range(offset, offset + limit - 1);
        return { data: data as { id: string }[] | null, error };
      },
    );

    // 先頭ページで DB エラーが出ると fetchAllPaged は rows=[] を返すため「0 件＝skipped 成功」に
    // 化けて無音スキップになる。error を error ログ＋500 で可視化する。
    if (facilitiesError) {
      return cronError('customer-segment', startedAt, facilitiesError, { message: 'Internal Server Error' });
    }

    if (facilities.length === 0) {
      await logCronRun('customer-segment', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, status: 'ok', count: 0 });
    }

    const now = new Date();
    // 今回書く行の updated_at。これより古い行は今回の集計に現れなかった＝もう該当しないお客様。
    const runStamp = now.toISOString();
    const twoYearsAgo = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    let count = 0;
    let skipped = 0;
    let deferred = 0;
    let processingFailures = 0;

    // 今回の集計に現れなかったお客様の行を消す。失敗は false（呼び出し側で失敗として数える）。
    const removeStaleSegments = async (facilityId: string): Promise<boolean> => {
      const { error } = await supabase
        .from('customer_segments')
        .delete()
        .eq('facility_id', facilityId)
        .lt('updated_at', runStamp);
      if (error) {
        console.error('[customer-segment] stale segment cleanup failed', { facilityId, err: error });
        return false;
      }
      return true;
    };

    const loopStart = Date.now();
    for (const facility of facilities) {
      // 時間予算超過で残りを翌週 run へ繰延（ハード timeout で全停止するより graceful。
      // RFM は毎週再計算されるため繰延分は次サイクルで回復する）。
      if (Date.now() - loopStart > SEGMENT_BUDGET_MS) {
        deferred = facilities.length - count - skipped;
        console.warn('[customer-segment] time budget exceeded, deferring rest to next run', { deferred });
        break;
      }
      // 完了済み予約からメール別に集計（直近2年分・全件）。
      // 旧実装は .limit(2000) で繁忙施設の集計が頭打ち（RFM が途中のデータでしか算出されず不正確）だった。
      // fetchAllPaged で全件ページング取得し切り捨てを解消（同ファイルの施設取得と同じ方式・全ロジックはJS）。
      // RFM の顧客識別は email_canonical（Gmail 別名統合）で行い、同一人物の分裂を防ぐ（round: email_canonical 列方式）。
      // メールの無い予約は電話番号で識別する（customerIdentityKey）。
      // email_canonical 列が未適用(migration前)なら生 email にフォールバックし JS で canonical 化（無破壊・デプロイ順序非依存）。
      type BookingRow = { email_canonical?: string | null; email?: string | null; phone?: string | null; customer_name: string | null; booking_date: string; total_price: number | null; status: string };
      const fetchBookings = (col: 'email_canonical' | 'email') => fetchAllPaged<BookingRow>(
        async (offset, limit) => {
          const { data, error } = await supabase
            .from('bookings')
            .select(`${col}, phone, customer_name, booking_date, total_price, status`)
            .eq('facility_id', facility.id)
            // RFM（来店回数・利用額・最終来店日）は実来店＝completed のみで算出する。以前は confirmed
            // （未来の予約も含む）を混入させ、未提供サービスを利用額に計上し last_visit が未来日になり
            // daysSince が負＝recency が壊れ VIP 誤分類を生んでいた（コメント「完了済み予約から」と乖離）。
            .in('status', ['completed'])
            .gte('booking_date', twoYearsAgo)
            .range(offset, offset + limit - 1);
          return { data: data as BookingRow[] | null, error };
        },
      );
      const firstFetch = await fetchBookings('email_canonical');
      let bookings = firstFetch.rows;
      // 件数上限で打ち切った回は「全員を集計した」と言えないので、古い行の削除はしない。
      let bookingsTruncated = firstFetch.truncated;
      let usingCanonicalColumn = true;
      let bookingsError = firstFetch.error as DbError | null;
      if (isMissingColumnError(bookingsError)) {
        const fallback = await fetchBookings('email');
        bookings = fallback.rows;
        bookingsTruncated = fallback.truncated;
        usingCanonicalColumn = false;
        bookingsError = fallback.error as DbError | null;
      }

      // 列欠落以外の DB エラーは fetchAllPaged が rows=[] を返すため「予約 0 件＝skip」に化けて
      // 無音スキップになり、当該施設の RFM が更新されない。error を可視化して次施設へ進む
      // （1 施設の失敗で他施設を止めない best-effort・skip として計上）。
      if (bookingsError) {
        console.error('[customer-segment] bookings fetch failed', { facilityId: facility.id, err: bookingsError });
        processingFailures++;
        skipped++;
        continue;
      }

      // 完了予約が 1 件も無い施設は、残っている行がすべて該当しなくなった行。
      if (bookings.length === 0) {
        if (!(await removeStaleSegments(facility.id))) processingFailures++;
        skipped++;
        continue;
      }

      // お客様別に集計（メール、メールが無ければ電話番号。どちらも無い予約は数えない）
      const customerMap = new Map<string, {
        name: string;
        firstVisit: string;
        lastVisit: string;
        visits: number;
        spent: number;
      }>();

      for (const b of bookings) {
        // canonical 列があればそれを、無ければ生 email を（customerIdentityKey の中で）canonical 化して使う。
        const key = customerIdentityKey(usingCanonicalColumn ? b.email_canonical : b.email, b.phone);
        if (!key) continue;
        const existing = customerMap.get(key);
        if (existing) {
          existing.visits++;
          existing.spent += b.total_price || 0;
          if (b.booking_date < existing.firstVisit) existing.firstVisit = b.booking_date;
          if (b.booking_date > existing.lastVisit) existing.lastVisit = b.booking_date;
          if (b.customer_name) existing.name = b.customer_name;
        } else {
          customerMap.set(key, {
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
          updated_at: runStamp,
        };
      });

      const CHUNK = 500;
      let upsertFailed = false;
      for (let i = 0; i < upsertRows.length; i += CHUNK) {
        const { error: upsertErr } = await supabase
          .from('customer_segments')
          .upsert(upsertRows.slice(i, i + CHUNK), { onConflict: 'facility_id,customer_email' });
        if (upsertErr) {
          processingFailures++;
          upsertFailed = true;
          console.error('[customer-segment] upsert chunk failed', { facilityId: facility.id, chunkStart: i, err: upsertErr });
        }
      }

      // 書き込みが 1 つでも失敗した施設・予約を全件読めなかった施設では消さない
      // （今回書けなかった・読めなかったお客様の行まで「古い行」として消えるため）。
      if (!upsertFailed && !bookingsTruncated && !(await removeStaleSegments(facility.id))) processingFailures++;

      count++;
    }

    const meta = { deferred, processingFailures };
    if (processingFailures) return cronError(
      'customer-segment', startedAt, 'Customer segment processing failed', {
        extraLog: { processed: count, skipped, meta },
        extraBody: { processed: count, skipped, ...meta },
      },
    );
    await logCronRun('customer-segment', 'success', startedAt, { processed: count, skipped, meta });
    return NextResponse.json({ processed: count, skipped, deferred });
  } catch (e) {
    console.error('[customer-segment] Error:', e);
    return cronError('customer-segment', startedAt, e);
  }
}
