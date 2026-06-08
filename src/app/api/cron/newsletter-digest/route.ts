import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { Resend } from 'resend';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { fetchAllPaged } from '@/lib/paginate';
import { createHmac } from 'crypto';

function makeUnsubToken(email: string): string {
  const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  // GET 冒頭の env ガード（!NEWSLETTER_UNSUBSCRIBE_SECRET → 503）を通過した後でのみ
  // 送信ループから呼ばれるため、ここに到達する時点で secret は必ず存在する（防御的チェック）。
  /* istanbul ignore next -- 上位 env ガードにより到達不能な防御コード */
  if (!secret) throw new Error('NEWSLETTER_UNSUBSCRIBE_SECRET is not set');
  return createHmac('sha256', secret).update(email.toLowerCase()).digest('hex');
}

function unsubUrl(email: string): string {
  return `https://carelink-jp.com/unsubscribe?email=${encodeURIComponent(email)}&hmac=${makeUnsubToken(email)}`;
}

function maskEmail(email: string): string {
  return email.replace(/(.).*@/, '$1***@');
}

// Monthly newsletter cron — 専用 workflow newsletter-digest.yml が毎月 1〜7 日に self-heal 再試行する。
// GitHub Actions スケジュールは best-effort で単一 tick がドロップし得るため、複数日試行＋下記の
// exactly-once（per-email 台帳 newsletter_send_log ＋ 決定的 idempotency key）で「当月ちょうど1回」送る。
export const dynamic = 'force-dynamic';
// 全プラン安全な明示値（Hobby 上限60s / Pro 上限300s のいずれでも有効）。
// 既定の低い値を上書きし、下の SEND_BUDGET_MS による予算ガードが確実に発火する既知の上限を与える。
export const maxDuration = 60;

// 送信ループの実時間予算。maxDuration(60s) 未満に設定し、超えたら残りを翌日 self-heal run へ回す。
// 打ち切られた分は台帳に未記録のまま＝翌 run で確実に再送される（恒久 miss なし）。
const SEND_BUDGET_MS = 50 * 1000;

export async function GET(req: NextRequest) {
  const cronAuthError = checkCronAuth(req);
  if (cronAuthError) return cronAuthError;

  if (!process.env.NEWSLETTER_UNSUBSCRIBE_SECRET) {
    return NextResponse.json({ error: 'NEWSLETTER_UNSUBSCRIBE_SECRET is not configured' }, { status: 503 });
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY is not configured' }, { status: 503 });
  }

  const startedAt = new Date();
  const admin = createServiceRoleClient();

  try {
    const now = new Date();
    const month = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' });
    // 配信対象月キー 'YYYY-MM'(UTC)。台帳・idempotency key の名前空間。
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Fast path: 当月キャンペーンが既に 'sent' なら何もしない（self-heal の2回目以降はここで即終了）。
    const { data: sentCampaign } = await admin
      .from('newsletter_campaigns')
      .select('id')
      .eq('campaign_type', 'owner_monthly')
      .eq('status', 'sent')
      .gte('sent_at', startOfMonth)
      .limit(1);

    if (sentCampaign && sentCampaign.length > 0) {
      await logCronRun('newsletter-digest', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ skipped: true, reason: 'Already sent this month' });
    }

    // Get booking stats for last month
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

    const { count: newBookings } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfLastMonth)
      .lte('created_at', endOfLastMonth);

    const { count: newReviews } = await admin
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfLastMonth)
      .lte('created_at', endOfLastMonth);

    const { count: newFacilities } = await admin
      .from('facility_profiles')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfLastMonth)
      .lte('created_at', endOfLastMonth);

    // Build HTML body (unsubscribe URL is per-recipient, appended at send time)
    const htmlBody = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,sans-serif;background:#f5f5f5;margin:0;padding:0">
  <div style="max-width:600px;margin:0 auto;background:#fff">
    <div style="background:linear-gradient(135deg,#0ea5e9,#38bdf8);padding:40px 32px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:24px">CareLink</h1>
      <p style="color:#e0f2fe;margin:8px 0 0;font-size:14px">${month}号 施設オーナー向けニュースレター</p>
    </div>
    <div style="padding:32px">
      <p style="color:#374151;font-size:15px;line-height:1.6">いつもCareLink をご利用いただきありがとうございます。${month}の活動サマリーをお届けします。</p>

      <div style="background:#f0f9ff;border-radius:12px;padding:24px;margin:24px 0">
        <h2 style="color:#0369a1;font-size:18px;margin:0 0 16px">プラットフォーム全体の動き</h2>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <div style="flex:1;min-width:120px;background:#fff;border-radius:8px;padding:16px;text-align:center">
            <div style="font-size:28px;font-weight:bold;color:#0ea5e9">${newBookings ?? 0}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:4px">新規予約</div>
          </div>
          <div style="flex:1;min-width:120px;background:#fff;border-radius:8px;padding:16px;text-align:center">
            <div style="font-size:28px;font-weight:bold;color:#10b981">${newReviews ?? 0}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:4px">新着口コミ</div>
          </div>
          <div style="flex:1;min-width:120px;background:#fff;border-radius:8px;padding:16px;text-align:center">
            <div style="font-size:28px;font-weight:bold;color:#f59e0b">${newFacilities ?? 0}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:4px">新規掲載</div>
          </div>
        </div>
      </div>

      <div style="margin:24px 0">
        <h2 style="color:#111827;font-size:18px">今月のTips</h2>
        <ul style="color:#374151;font-size:14px;line-height:1.8;padding-left:20px">
          <li>写真を5枚以上登録すると、予約率が平均<strong>32%</strong>向上します</li>
          <li>口コミへの返信で信頼度が上がります。返信率80%以上を目指しましょう</li>
          <li>スタッフ紹介ページを充実させると指名予約が増える傾向があります</li>
        </ul>
      </div>

      <div style="background:#fef3c7;border-radius:8px;padding:16px;margin:24px 0">
        <p style="color:#92400e;font-size:14px;margin:0">
          <strong>お知らせ</strong>: 管理画面から月次レポート（予約数・売上）をいつでも確認できます。
          <a href="https://carelink-jp.com/admin/analytics" style="color:#d97706">管理画面を開く →</a>
        </p>
      </div>

      <div style="text-align:center;margin:32px 0">
        <a href="https://carelink-jp.com/admin" style="background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">管理画面を確認する</a>
      </div>
    </div>
    __UNSUB_FOOTER__
  </div>
</body>
</html>`;

    // 当月の owner_monthly キャンペーンを find-or-create（'sent' は上の fast path で除外済み）。
    // self-heal の2回目以降は既存の 'sending' 行を再利用する。同時実行で稀に2行できても
    // 送信の重複は per-email 台帳が防ぐため害はない（campaign 行は監査・watcher 用）。
    const { data: existingCampaign } = await admin
      .from('newsletter_campaigns')
      .select('id')
      .eq('campaign_type', 'owner_monthly')
      .gte('created_at', startOfMonth)
      .order('created_at', { ascending: false })
      .limit(1);

    let campaignId: string;
    if (existingCampaign && existingCampaign.length > 0) {
      campaignId = existingCampaign[0].id as string;
    } else {
      const { data: campaign, error: insertErr } = await admin
        .from('newsletter_campaigns')
        .insert({
          campaign_type: 'owner_monthly',
          subject: `【CareLink】${month}号 施設オーナー向けニュースレター`,
          html_content: htmlBody,
          status: 'sending',
        })
        .select()
        .single();
      if (insertErr || !campaign) {
        console.error('[newsletter-digest] campaign insert error:', insertErr);
        await logCronRun('newsletter-digest', 'error', startedAt, { processed: 0, error_msg: insertErr?.message });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
      }
      campaignId = campaign.id as string;
    }

    // Get all owner emails. PostgREST の db-max-rows(1000) を全件ページング（共有ヘルパ）で越える。安全上限5万人。
    type OwnerRow = { profiles: { email: string } | { email: string }[] | null };
    const { rows: owners } = await fetchAllPaged<OwnerRow>(
      async (offset, limit) => {
        const { data, error } = await admin
          .from('facility_members')
          .select('profiles(email)')
          .eq('role', 'owner')
          .range(offset, offset + limit - 1);
        return { data: data as OwnerRow[] | null, error };
      },
      { maxRows: 50000 },
    );

    const emails: string[] = owners
      .map((o: { profiles: { email: string } | { email: string }[] | null }) => {
        const p = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
        return p?.email;
      })
      .filter(Boolean) as string[];

    const uniqueEmails = Array.from(new Set(emails));

    // 配信停止者を除外する（特定電子メール法: 配信停止の意思表示後の送信は禁止）。
    const { rows: unsubProfiles } = await fetchAllPaged<{ email: string | null }>(
      async (offset, limit) => {
        const { data, error } = await admin
          .from('profiles')
          .select('email')
          .eq('email_unsubscribed', true)
          .range(offset, offset + limit - 1);
        return { data: data as { email: string | null }[] | null, error };
      },
      { maxRows: 100000 },
    );
    const { rows: unsubNewsletter } = await fetchAllPaged<{ email: string | null }>(
      async (offset, limit) => {
        const { data, error } = await admin
          .from('newsletter_subscriptions')
          .select('email')
          .eq('is_active', false)
          .range(offset, offset + limit - 1);
        return { data: data as { email: string | null }[] | null, error };
      },
      { maxRows: 100000 },
    );
    const unsubscribed = new Set<string>([
      ...(unsubProfiles.map((r) => r.email).filter(Boolean) as string[]),
      ...(unsubNewsletter.map((r) => r.email).filter(Boolean) as string[]),
    ]);
    const sendableEmails = uniqueEmails.filter((e) => !unsubscribed.has(e));

    // 当月すでに送信済みのアドレス（台帳）を取得し、未送信分のみに絞る（exactly-once の核）。
    const { rows: ledgerRows } = await fetchAllPaged<{ email: string }>(
      async (offset, limit) => {
        const { data, error } = await admin
          .from('newsletter_send_log')
          .select('email')
          .eq('period', period)
          .range(offset, offset + limit - 1);
        return { data: data as { email: string }[] | null, error };
      },
      { maxRows: 200000 },
    );
    const alreadySent = new Set(ledgerRows.map((r) => r.email));
    const toSend = sendableEmails.filter((e) => !alreadySent.has(e));

    const resend = new Resend(process.env.RESEND_API_KEY);
    const subject = `【CareLink】${month}号 施設オーナー向けニュースレター`;
    const loopStart = Date.now();
    let sentCount = 0;
    let failedCount = 0;
    let deferred = 0;

    // 1 通ずつ「決定的 idempotency key 付き」で送信し、成功したら台帳に記録する。
    // - 送信前に予算ガード: 残りは台帳未記録のまま break ＝翌日 self-heal run が再処理（恒久 miss なし）。
    // - idempotencyKey=`nl:${period}:${email}` により、台帳記録前のクラッシュで翌 run が再送しても
    //   Resend 側で重複排除される（二重送信なし）。
    // - 送信失敗(throw)は台帳に残らない＝翌 run で再送（未送信なし）。
    for (let i = 0; i < toSend.length; i++) {
      if (Date.now() - loopStart > SEND_BUDGET_MS) {
        deferred = toSend.length - i;
        console.warn('[newsletter-digest] time budget exceeded, deferring rest to next self-heal run', { deferred });
        break;
      }
      const email = toSend[i];
      const footer = `<div style="background:#f9fafb;padding:24px 32px;text-align:center"><p style="color:#9ca3af;font-size:12px;margin:0">CareLink | carelink-jp.com<br><a href="${unsubUrl(email)}" style="color:#9ca3af">配信停止はこちら</a></p></div>`;
      try {
        await resend.emails.send(
          {
            from: 'CareLink <newsletter@carelink-jp.com>',
            to: [email],
            subject,
            html: htmlBody.replace('__UNSUB_FOOTER__', footer),
          },
          { idempotencyKey: `nl:${period}:${email}` },
        );
        const { error: logErr } = await admin
          .from('newsletter_send_log')
          .insert({ period, email, campaign_id: campaignId });
        // 23505 = 並行 run が同じ (period,email) を先に記録済み（=送信は idempotencyKey で重複排除済み）。無害。
        if (logErr && (logErr as { code?: string }).code !== '23505') {
          console.error('[newsletter-digest] send-log insert failed', { email: maskEmail(email), err: logErr });
        }
        sentCount++;
      } catch (err) {
        console.error('[newsletter-digest] send failed', { email: maskEmail(email), err });
        failedCount++;
      }
    }

    // 当月の未送信を全て送り切った（予算超過も送信失敗も無い）場合のみ campaign を 'sent' にする。
    // 失敗や持ち越しが残る間は 'sending' のまま → 翌日 self-heal run が残りを再送し、完了時に 'sent' になる。
    const completed = deferred === 0 && failedCount === 0;
    if (completed) {
      const { error: campaignUpdateErr } = await admin
        .from('newsletter_campaigns')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          stats: { sent: alreadySent.size + sentCount, opened: 0, clicked: 0, bounced: 0, failed: 0 },
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignId);
      if (campaignUpdateErr) {
        console.error('[newsletter-digest] campaign status update failed — watcher may re-alert', { campaignId, err: campaignUpdateErr });
      }
    }

    // 完了時のみ 'success'（watcher の発火判定シグナル）。未完了(持ち越し/失敗)は 'skipped' とし、
    // success を出さないことで watcher が day8 まで「未完了」を検知し続けられるようにする
    // （'error' は Slack 通報を誘発するため、進行中の持ち越しには使わない）。
    await logCronRun('newsletter-digest', completed ? 'success' : 'skipped', startedAt, {
      processed: sentCount,
      skipped: failedCount,
      meta: { campaignId, deferred, alreadySent: alreadySent.size, completed },
    });

    return NextResponse.json({ processed: sentCount, skipped: failedCount, deferred, completed, campaignId });
  } catch (e) {
    console.error('[newsletter-digest] Error:', e);
    await logCronRun('newsletter-digest', 'error', startedAt, {
      error_msg: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
