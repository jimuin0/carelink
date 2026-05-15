import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'gbp-posts-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('facility_members').select('facility_id').eq('user_id', user.id).in('role', ['owner', 'admin']).limit(1).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabase
    .from('gbp_posts')
    .select('*')
    .eq('facility_id', membership.facility_id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ posts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'gbp-posts')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('facility_members').select('facility_id').eq('user_id', user.id).in('role', ['owner', 'admin']).limit(1).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { title, body: postBody, post_type, photo_url, cta_type, cta_url, scheduled_at } = body;

  if (!postBody?.trim()) return NextResponse.json({ error: 'body is required' }, { status: 400 });

  const VALID_POST_TYPES = ['STANDARD', 'EVENT', 'OFFER'];
  const VALID_CTA_TYPES = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'];

  const { data, error } = await supabase
    .from('gbp_posts')
    .insert({
      facility_id: membership.facility_id,
      title: title ? String(title).slice(0, 200) : null,
      body: String(postBody).slice(0, 1500),
      post_type: VALID_POST_TYPES.includes(post_type) ? post_type : 'STANDARD',
      photo_url: photo_url && /^https:\/\/[^\s]{1,490}$/.test(String(photo_url)) ? String(photo_url) : null,
      cta_type: VALID_CTA_TYPES.includes(cta_type) ? cta_type : null,
      cta_url: cta_url && /^https:\/\/[^\s]{1,490}$/.test(String(cta_url)) ? String(cta_url) : null,
      status: scheduled_at ? 'scheduled' : 'draft',
      scheduled_at: scheduled_at || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ post: data });
}

export async function PATCH(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'gbp-posts-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('facility_members').select('facility_id').eq('user_id', user.id).in('role', ['owner', 'admin']).limit(1).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { id, title, body: postBody, post_type, photo_url, cta_type, cta_url, status, scheduled_at, published_at } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!UUID_REGEX.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const VALID_POST_TYPES = ['STANDARD', 'EVENT', 'OFFER'];
  const VALID_CTA_TYPES = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'];
  const VALID_STATUSES = ['draft', 'scheduled', 'published', 'cancelled'];

  const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) allowed.title = title ? String(title).slice(0, 200) : null;
  if (postBody !== undefined) allowed.body = String(postBody).slice(0, 1500);
  if (post_type !== undefined && VALID_POST_TYPES.includes(post_type)) allowed.post_type = post_type;
  if (photo_url !== undefined) allowed.photo_url = photo_url && /^https:\/\/[^\s]{1,490}$/.test(String(photo_url)) ? String(photo_url) : null;
  if (cta_type !== undefined) allowed.cta_type = VALID_CTA_TYPES.includes(cta_type) ? cta_type : null;
  if (cta_url !== undefined) allowed.cta_url = cta_url && /^https:\/\/[^\s]{1,490}$/.test(String(cta_url)) ? String(cta_url) : null;
  if (status !== undefined && VALID_STATUSES.includes(status)) allowed.status = status;
  if (scheduled_at !== undefined) allowed.scheduled_at = scheduled_at || null;
  if (published_at !== undefined) allowed.published_at = published_at || null;

  const { error } = await supabase
    .from('gbp_posts')
    .update(allowed)
    .eq('id', id)
    .eq('facility_id', membership.facility_id);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'gbp-posts-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('facility_members').select('facility_id').eq('user_id', user.id).in('role', ['owner', 'admin']).limit(1).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!UUID_REGEX.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const { error } = await supabase
    .from('gbp_posts')
    .delete()
    .eq('id', id)
    .eq('facility_id', membership.facility_id);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
