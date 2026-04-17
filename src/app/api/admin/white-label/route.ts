import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { randomBytes } from 'crypto';

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

export async function GET() {
  const supabase = createServerSupabaseAuthClient();
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
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await getFacilityId(user.id);
  if (!facilityId) return NextResponse.json({ error: 'No facility' }, { status: 403 });

  const { domain, brand_name, primary_color, logo_url } = await req.json();

  if (!domain) return NextResponse.json({ error: 'domain required' }, { status: 400 });

  // Validate domain format (basic)
  const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
  if (!domainRegex.test(domain)) {
    return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 });
  }

  const txtRecord = `carelink-verify=${randomBytes(16).toString('hex')}`;

  const admin = createServiceRoleClient();
  const { data: config, error } = await admin
    .from('white_label_domains')
    .upsert({
      facility_id: facilityId,
      domain: domain.toLowerCase(),
      brand_name: brand_name || null,
      primary_color: primary_color || '#0ea5e9',
      logo_url: logo_url || null,
      txt_record: txtRecord,
      is_verified: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'facility_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config }, { status: 201 });
}
