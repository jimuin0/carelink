import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { Resend } from 'resend';

async function requirePlatformAdmin() {
  const supabase = createServerSupabaseAuthClient();
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { action } = await req.json();
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
    const { data: updated } = await admin
      .from('newsletter_campaigns')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .select()
      .single();
    return NextResponse.json({ campaign: updated });
  }

  if (action === 'schedule') {
    if (campaign.status !== 'draft') {
      return NextResponse.json({ error: 'Only draft campaigns can be scheduled' }, { status: 400 });
    }
    const { data: updated } = await admin
      .from('newsletter_campaigns')
      .update({ status: 'scheduled', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .select()
      .single();
    return NextResponse.json({ campaign: updated });
  }

  if (action === 'send') {
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return NextResponse.json({ error: 'Cannot send campaign in current status' }, { status: 400 });
    }

    // Mark as sending
    await admin
      .from('newsletter_campaigns')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', params.id);

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
      const { data: owners } = await admin
        .from('facility_members')
        .select('profiles(email)')
        .eq('role', 'owner');
      const ownerEmails = (owners || [])
        .map((o: { profiles: { email: string } | { email: string }[] | null }) => {
          const p = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
          return p?.email;
        })
        .filter(Boolean) as string[];
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

    // Send in batches of 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      try {
        await resend.emails.send({
          from: 'CareLink <newsletter@carelink-jp.com>',
          to: batch,
          subject: campaign.subject,
          html: campaign.html_content + `<br><br><hr><p style="font-size:11px;color:#999">配信停止は<a href="https://carelink-jp.com/unsubscribe?id=${campaign.id}">こちら</a></p>`,
          text: campaign.text_content || undefined,
        });
        sentCount += batch.length;
      } catch {
        bouncedCount += batch.length;
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

    return NextResponse.json({ campaign: updated, sentCount, bouncedCount });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
