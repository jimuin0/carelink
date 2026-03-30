import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFacilityBySlug, getFacilityMenus } from '@/lib/facilities';
import { getStaffByFacility } from '@/lib/staff';
import { getCouponsByFacility } from '@/lib/coupons';
import BookingFlow from '@/components/booking/BookingFlow';

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
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

export default async function BookingPage({ params }: Props) {
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) notFound();

  const [staff, { menus }, coupons] = await Promise.all([
    getStaffByFacility(facility.id),
    getFacilityMenus(facility.id),
    getCouponsByFacility(facility.id),
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
        />
      </div>
    </div>
  );
}
