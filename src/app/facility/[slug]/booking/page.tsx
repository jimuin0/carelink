import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFacilityBySlug, getFacilityMenus } from '@/lib/facilities';
import { getStaffByFacility } from '@/lib/staff';
import { getCouponsByFacility } from '@/lib/coupons';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import BookingFlow from '@/components/booking/BookingFlow';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) return {};
  const title = `予約 | ${facility.name} | CareLink`;
  const description = `${facility.name}のオンライン予約ページ`;
  return {
    title,
    description,
    openGraph: { title, description },
    robots: { index: false, follow: true },
  };
}

export default async function BookingPage(props: Props) {
  const params = await props.params;
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) notFound();

  const [staff, { menus }, coupons, hasIntake] = await Promise.all([
    getStaffByFacility(facility.id),
    getFacilityMenus(facility.id),
    getCouponsByFacility(facility.id),
    // この施設に有効な問診票テンプレがあるかを確認し、完了画面の問診票導線表示に渡す（scale監査 #6・配線漏れ修正）
    (async () => {
      const supabase = createServerSupabaseClient();
      const { data } = await supabase
        .from('intake_form_templates')
        .select('id')
        .eq('facility_id', facility.id)
        .eq('is_active', true)
        .maybeSingle();
      return !!data;
    })(),
  ]);

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold mb-2">{facility.name}</h1>
        <p className="text-sm text-gray-500 mb-6">オンライン予約</p>

        <BookingFlow
          facility={{ id: facility.id, slug: params.slug, name: facility.name }}
          staff={staff}
          menus={menus}
          coupons={coupons}
          hasIntake={hasIntake}
        />
      </div>
    </div>
  );
}
