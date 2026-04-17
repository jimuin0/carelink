import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';

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

export async function GET() {
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data: campaigns, error } = await admin
    .from('newsletter_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { campaign_type, subject, html_content, text_content, scheduled_at } = body;

  if (!campaign_type || !subject || !html_content) {
    return NextResponse.json({ error: 'campaign_type, subject, html_content are required' }, { status: 400 });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign }, { status: 201 });
}
