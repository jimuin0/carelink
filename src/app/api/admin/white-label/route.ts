import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { randomBytes } from 'crypto';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

async function getFacilityId(userId: string) {
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .in('role', ['owner', 'admin'])
    .limit(1)
    .single();
  return data?.facility_id;
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'white-label-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await getFacilityId(user.id);
  if (!facilityId) return NextResponse.json({ error: 'No facility' }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data: config } = await admin
    .from('white_label_domains')
    .select('*')
    .eq('facility_id', facilityId)
    .single();

  return NextResponse.json({ config: config || null });
}

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'white-label')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await getFacilityId(user.id);
  if (!facilityId) return NextResponse.json({ error: 'No facility' }, { status: 403 });

  const { domain, brand_name, primary_color, logo_url } = await req.json().catch(() => ({}));

  if (!domain || typeof domain !== 'string') return NextResponse.json({ error: 'domain required' }, { status: 400 });
  if (domain.length > 253) return NextResponse.json({ error: 'domain too long' }, { status: 400 });

  // Validate domain format — split by label to avoid nested-quantifier ReDoS
  const labelRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
  const labels = domain.split('.');
  const domainValid = labels.length >= 2 && labels.every((label) => label.length >= 1 && label.length <= 63 && labelRegex.test(label));
  if (!domainValid) {
    return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 });
  }

  const txtRecord = `carelink-verify=${randomBytes(16).toString('hex')}`;

  const admin = createServiceRoleClient();
  const { data: config, error } = await admin
    .from('white_label_domains')
    .upsert({
      facility_id: facilityId,
      domain: domain.toLowerCase(),
      brand_name: brand_name ? String(brand_name).slice(0, 100) : null,
      primary_color: primary_color && /^#[0-9a-fA-F]{6}$/.test(primary_color) ? primary_color : '#0ea5e9',
      logo_url: logo_url && /^https:\/\/[^\s]{1,490}$/.test(String(logo_url)) ? String(logo_url) : null,
      txt_record: txtRecord,
      is_verified: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'facility_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ config }, { status: 201 });
}
