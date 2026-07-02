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
      } catch {
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
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
