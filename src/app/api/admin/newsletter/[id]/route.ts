import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { Resend } from 'resend';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { escSubject } from '@/lib/email';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { newsletterUnsubUrl } from '@/lib/newsletter-unsub';

async function requirePlatformAdmin() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_platform_admin) return null;
  return user;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 5, 60_000 * 10, 'newsletter-send')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { action } = await req.json().catch(() => ({}));
  const admin = createServiceRoleClient();

  const { data: campaign, error: fetchErr } = await admin
    .from('newsletter_campaigns')
    .select('*')
    .eq('id', params.id)
    .single();

  if (fetchErr || !campaign) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (action === 'cancel') {
    if (campaign.status !== 'scheduled') {
      return NextResponse.json({ error: 'Only scheduled campaigns can be cancelled' }, { status: 400 });
    }
    const { data: updated, error: cancelErr } = await admin
      .from('newsletter_campaigns')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .select()
      .single();
    if (cancelErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    return NextResponse.json({ campaign: updated });
  }

  if (action === 'schedule') {
    if (campaign.status !== 'draft') {
      return NextResponse.json({ error: 'Only draft campaigns can be scheduled' }, { status: 400 });
    }
    const { data: updated, error: scheduleErr } = await admin
      .from('newsletter_campaigns')
      .update({ status: 'scheduled', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .select()
      .single();
    if (scheduleErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    return NextResponse.json({ campaign: updated });
  }

  if (action === 'send') {
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return NextResponse.json({ error: 'Cannot send campaign in current status' }, { status: 400 });
    }

    // Atomically claim the send slot: only update if status is still draft/scheduled.
    // This prevents double-sends if two requests race through the status check above.
    const { data: claimed } = await admin
      .from('newsletter_campaigns')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .in('status', ['draft', 'scheduled'])
      .select('id');

    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ error: 'Campaign is already being sent or has been sent' }, { status: 409 });
    }

    // claim（status='sending'）後のこの一連の処理は、途中で予期しない例外が起きると
    // キャンペーンが 'sending' に固着し、cancel（scheduled 限定）・schedule（draft 限定）
    // ・send（draft/scheduled 限定）のいずれからも復旧できなくなる恒久デッドロックだった
    // （実バグ）。全体を try/catch で包み、claim 後のどの段階で失敗しても必ず 'draft' へ
    // ロールバックする（再送・キャンセルが可能な状態に戻す）。
    try {
      // RESEND_API_KEY 未設定を明示的に事前ガードする。従来は new Resend(undefined) が
      // batch.send() で例外を投げ、それを catch → 全件 bounced 計上 → それでも
      // status='sent' に確定していた（実際には1通も届いていないのに送信済み扱いになり
      // 再送不可＝fail-open だった実バグ）。未設定なら送信を試みず 503 で明確に止める。
      if (!process.env.RESEND_API_KEY) {
        console.error('[newsletter/send] RESEND_API_KEY not configured — aborting send', { campaignId: params.id });
        await admin.from('newsletter_campaigns').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', params.id);
        return NextResponse.json({ error: 'メール送信設定(RESEND_API_KEY)が未完了のため送信を中止しました' }, { status: 503 });
      }

      // Determine subscription_type filter
      const subType = campaign.campaign_type === 'owner_monthly' ? 'owner_monthly' : 'user_digest';

      // Get subscribers
      const { data: subscribers } = await admin
        .from('newsletter_subscriptions')
        .select('email, user_id')
        .or(`subscription_type.eq.${subType},subscription_type.eq.all`)
        .eq('is_active', true);

      // For owner_monthly: also pull facility owner emails if no subscription record
      let emails: string[] = [];
      if (campaign.campaign_type === 'owner_monthly') {
        // profiles(email) を embed しない：facility_members.user_id は auth.users(id) 参照で
        // facility_members→profiles の FK が無く、PostgREST が関係を解決できず常時エラーになり
        // owner_monthly のオーナー宛メールが全スキップされる実バグになる（user-packages と同根）。
        // owner の user_id を取得し profiles を別取得してメールを引く（best-effort・失敗はログのみで続行）。
        const { data: owners, error: ownersErr } = await admin
          .from('facility_members')
          .select('user_id')
          .eq('role', 'owner');
        if (ownersErr) console.error('[newsletter/send] owner email fetch failed — some owners may be skipped', { campaignId: params.id, err: ownersErr });
        const ownerUserIds = Array.from(new Set((owners || []).map((o: { user_id: string | null }) => o.user_id).filter(Boolean) as string[]));
        let ownerEmails: string[] = [];
        if (ownerUserIds.length > 0) {
          const { data: ownerProfiles, error: ownerProfErr } = await admin
            .from('profiles')
            .select('email')
            .in('id', ownerUserIds);
          if (ownerProfErr) console.error('[newsletter/send] owner profiles fetch failed — some owners may be skipped', { campaignId: params.id, err: ownerProfErr });
          ownerEmails = (ownerProfiles || []).map((p: { email: string | null }) => p.email).filter(Boolean) as string[];
        }
        emails = Array.from(new Set([
          ...(subscribers || []).map((s: { email: string | null }) => s.email).filter(Boolean) as string[],
          ...ownerEmails,
        ]));
      } else {
        emails = (subscribers || []).map((s: { email: string | null }) => s.email).filter(Boolean) as string[];
      }

      // 配信停止の一次ソースは profiles.email_unsubscribed（アカウント有無に依存しない唯一の
      // 真実源。/api/unsubscribe の方式A(トークン)は newsletter_subscriptions を更新せず
      // profiles のみ更新するため、newsletter_subscriptions.is_active フィルタだけでは
      // 停止済みユーザーへの送信を防げない）。owner_monthly の ownerEmails は
      // newsletter_subscriptions を一切経由しないため、これが唯一の除外手段でもある。
      // 送信直前に両テーブルを必ず突合し、どちらかで停止済みなら除外する（fail-safe：
      // 取得失敗時は空集合扱いにせず処理を中断し、停止済みへの誤送信を防ぐ）。
      // メールは大小文字表記揺れを吸収するため小文字で突合する（例: unsubscribeByEmail 側も
      // toLowerCase 済み・大小文字違いの二重登録による停止漏れを防ぐ）。
      emails = Array.from(new Set(emails.map((e) => e.toLowerCase())));
      if (emails.length > 0) {
        const { data: unsubProfiles, error: unsubProfilesErr } = await admin
          .from('profiles')
          .select('email')
          .not('email', 'is', null)
          .eq('email_unsubscribed', true);
        if (unsubProfilesErr) {
          console.error('[newsletter/send] unsubscribed profiles fetch failed — aborting to avoid sending to opted-out users', { campaignId: params.id, err: unsubProfilesErr });
          await admin.from('newsletter_campaigns').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', params.id);
          return NextResponse.json({ error: '配信停止者リストの取得に失敗したため送信を中止しました' }, { status: 500 });
        }
        const { data: inactiveSubs, error: inactiveSubsErr } = await admin
          .from('newsletter_subscriptions')
          .select('email')
          .not('email', 'is', null)
          .eq('is_active', false);
        if (inactiveSubsErr) {
          console.error('[newsletter/send] inactive subscriptions fetch failed — aborting to avoid sending to opted-out users', { campaignId: params.id, err: inactiveSubsErr });
          await admin.from('newsletter_campaigns').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', params.id);
          return NextResponse.json({ error: '配信停止者リストの取得に失敗したため送信を中止しました' }, { status: 500 });
        }
        const unsubscribed = new Set<string>([
          ...(unsubProfiles || []).map((p: { email: string | null }) => (p.email ?? '').toLowerCase()).filter(Boolean),
          ...(inactiveSubs || []).map((s: { email: string | null }) => (s.email ?? '').toLowerCase()).filter(Boolean),
        ]);
        emails = emails.filter((e) => !unsubscribed.has(e));
      }

      const resend = new Resend(process.env.RESEND_API_KEY);
      let sentCount = 0;
      let bouncedCount = 0;

      // Send individually (personalized unsubscribe URL per recipient).
      // Use resend.batch.send() in chunks of 100 (Resend batch limit).
      const BATCH_SIZE = 100;
      const subject = escSubject(campaign.subject);
      for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        const chunk = emails.slice(i, i + BATCH_SIZE);
        const messages = chunk.map((email) => ({
          from: 'CareLink <newsletter@carelink-jp.com>',
          to: [email],
          subject,
          html: campaign.html_content + `<br><br><hr><p style="font-size:11px;color:#999">配信停止は<a href="${newsletterUnsubUrl(email)}">こちら</a></p>`,
          text: campaign.text_content || undefined,
        }));
        try {
          await resend.batch.send(messages);
          sentCount += chunk.length;
        } catch (e) {
          console.error('[newsletter/send] batch chunk failed', { campaignId: params.id, chunkStart: i, chunkSize: chunk.length, err: e });
          bouncedCount += chunk.length;
        }
      }

      const { data: updated } = await admin
        .from('newsletter_campaigns')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          stats: { sent: sentCount, opened: 0, clicked: 0, bounced: bouncedCount },
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.id)
        .select()
        .single();

      const { ua } = getRequestContext(req);
      void writeAuditLog({
        userId: user.id,
        action: 'create',
        tableName: 'newsletter_campaigns',
        recordId: params.id,
        newValues: { action: 'send', campaign_type: campaign.campaign_type, subject: campaign.subject, sent_count: sentCount, bounced_count: bouncedCount },
        ipAddress: ip,
        userAgent: ua,
      });

      return NextResponse.json({ campaign: updated, sentCount, bouncedCount });
    } catch (e) {
      console.error('[newsletter/send] unexpected error during send — rolling back to draft', { campaignId: params.id, err: e });
      await admin.from('newsletter_campaigns').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', params.id);
      return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
