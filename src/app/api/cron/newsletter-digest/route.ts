import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { Resend } from 'resend';
import { checkCronAuth } from '@/lib/cron-auth';
import { createHmac } from 'crypto';

function makeUnsubToken(email: string): string {
  const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error('NEWSLETTER_UNSUBSCRIBE_SECRET is not set');
  return createHmac('sha256', secret).update(email.toLowerCase()).digest('hex');
}

function unsubUrl(email: string): string {
  return `https://carelink-jp.com/unsubscribe?email=${encodeURIComponent(email)}&hmac=${makeUnsubToken(email)}`;
}

// Monthly newsletter cron — runs on 1st of each month
// Sends owner_monthly digest to all facility owners
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cronAuthError = checkCronAuth(req);
  if (cronAuthError) return cronAuthError;

  const admin = createServiceRoleClient();
  const now = new Date();
  const month = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' });

  // Check if already sent this month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data: existing } = await admin
    .from('newsletter_campaigns')
    .select('id')
    .eq('campaign_type', 'owner_monthly')
    .eq('status', 'sent')
    .gte('sent_at', startOfMonth)
    .limit(1);

  if (existing && existing.length > 0) {
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

  // Create campaign record
  const { data: campaign, error: insertErr } = await admin
    .from('newsletter_campaigns')
    .insert({
      campaign_type: 'owner_monthly',
      subject: `【CareLink】${month}号 施設オーナー向けニュースレター`,
      html_content: html,
      status: 'sending',
    })
    .select()
    .single();

  if (insertErr || !campaign) {
    console.error('[newsletter-digest] insert error:', insertErr);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  // Get all owner emails
  const { data: owners } = await admin
    .from('facility_members')
    .select('profiles(email)')
    .eq('role', 'owner');

  const emails: string[] = (owners || [])
    .map((o: { profiles: { email: string } | { email: string }[] | null }) => {
      const p = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
      return p?.email;
    })
    .filter(Boolean) as string[];

  const uniqueEmails = Array.from(new Set(emails));

  const resend = new Resend(process.env.RESEND_API_KEY);
  let sentCount = 0;
  let bouncedCount = 0;
  const subject = `【CareLink】${month}号 施設オーナー向けニュースレター`;

  // Send individually with personalized unsubscribe URLs (batch of 100 = Resend limit)
  const BATCH_SIZE = 100;
  for (let i = 0; i < uniqueEmails.length; i += BATCH_SIZE) {
    const chunk = uniqueEmails.slice(i, i + BATCH_SIZE);
    const messages = chunk.map((email) => {
      const footer = `<div style="background:#f9fafb;padding:24px 32px;text-align:center"><p style="color:#9ca3af;font-size:12px;margin:0">CareLink | carelink-jp.com<br><a href="${unsubUrl(email)}" style="color:#9ca3af">配信停止はこちら</a></p></div>`;
      return {
        from: 'CareLink <newsletter@carelink-jp.com>',
        to: [email],
        subject,
        html: htmlBody.replace('__UNSUB_FOOTER__', footer),
      };
    });
    try {
      await resend.batch.send(messages);
      sentCount += chunk.length;
    } catch {
      bouncedCount += chunk.length;
    }
  }

  await admin
    .from('newsletter_campaigns')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      stats: { sent: sentCount, opened: 0, clicked: 0, bounced: bouncedCount },
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaign.id);

  // Log cron execution
  await admin.from('cron_logs').insert({
    job_name: 'newsletter-digest',
    status: 'success',
    message: `Sent ${sentCount} newsletters (${bouncedCount} bounced)`,
  }).then(() => null, () => null);

  return NextResponse.json({ ok: true, sentCount, bouncedCount, campaignId: campaign.id });
}
