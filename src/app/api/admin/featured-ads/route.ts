import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-service';

const PLAN_PRICES: Record<string, number> = {
  search_top: 9800,
  area_banner: 4900,
  category_top: 7800,
};

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
  const { data: slots } = await admin
    .from('featured_slots')
    .select('*')
    .eq('facility_id', facilityId)
    .order('starts_at', { ascending: false });

  return NextResponse.json({ slots: slots || [] });
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await getFacilityId(user.id);
  if (!facilityId) return NextResponse.json({ error: 'No facility' }, { status: 403 });

  const body = await req.json();
  const { slot_type, area, business_type, starts_at, ends_at } = body;

  if (!slot_type || !starts_at || !ends_at) {
    return NextResponse.json({ error: 'slot_type, starts_at, ends_at required' }, { status: 400 });
  }

  const VALID_TYPES = ['search_top', 'area_banner', 'category_top'];
  if (!VALID_TYPES.includes(slot_type)) {
    return NextResponse.json({ error: 'Invalid slot_type' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: slot, error } = await admin
    .from('featured_slots')
    .insert({
      facility_id: facilityId,
      slot_type,
      area: area || null,
      business_type: business_type || null,
      starts_at: new Date(starts_at).toISOString(),
      ends_at: new Date(ends_at).toISOString(),
      budget_yen: PLAN_PRICES[slot_type] || 0,
      is_active: false, // becomes active after payment
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // TODO: Create Stripe Checkout session for payment
  // For now, return slot directly (activate immediately in demo mode)
  return NextResponse.json({ slot }, { status: 201 });
}
