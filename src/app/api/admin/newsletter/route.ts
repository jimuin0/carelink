import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

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

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (inMemoryRateLimit(ip, 20, 60_000, 'newsletter-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data: campaigns, error } = await admin
    .from('newsletter_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (inMemoryRateLimit(ip, 5, 60_000, 'newsletter-create')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { campaign_type, subject, html_content, text_content, scheduled_at } = body;

  if (!campaign_type || !subject || !html_content) {
    return NextResponse.json({ error: 'campaign_type, subject, html_content are required' }, { status: 400 });
  }
  if (typeof subject !== 'string' || subject.length > 200) {
    return NextResponse.json({ error: 'subject must be a string under 200 chars' }, { status: 400 });
  }
  if (typeof html_content !== 'string' || html_content.length > 100_000) {
    return NextResponse.json({ error: 'html_content must be under 100KB' }, { status: 400 });
  }

  const VALID_TYPES = ['owner_monthly', 'user_digest', 'user_coupon', 'promo'];
  if (!VALID_TYPES.includes(campaign_type)) {
    return NextResponse.json({ error: 'Invalid campaign_type' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: campaign, error } = await admin
    .from('newsletter_campaigns')
    .insert({
      campaign_type,
      subject,
      html_content,
      text_content: text_content || null,
      scheduled_at: scheduled_at || null,
      status: 'draft',
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ua } = getRequestContext(req);
  void writeAuditLog({
    userId: user.id,
    action: 'create',
    tableName: 'newsletter_campaigns',
    recordId: campaign.id,
    newValues: { campaign_type, subject, scheduled_at: scheduled_at || null },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
