import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFacilityBySlug, getFacilityMenus, getFacilityCancelPolicy } from '@/lib/facilities';
import { getStaffByFacility } from '@/lib/staff';
import { getCouponsByFacility, getCouponMenus } from '@/lib/coupons';
import BookingFlow from '@/components/booking/BookingFlow';

interface Props {
  params: Promise<{ slug: string }>;
  // 再予約リンク（前回と同じ内容で予約）から渡るメニュー/スタッフの事前選択（A-6）。
  searchParams: Promise<{ menu_id?: string; staff_id?: string }>;
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
  const searchParams = await props.searchParams;
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) notFound();

  const [staff, { menus }, coupons, cancelPolicy] = await Promise.all([
    getStaffByFacility(facility.id),
    getFacilityMenus(facility.id),
    getCouponsByFacility(facility.id),
    getFacilityCancelPolicy(facility.id),
  ]);

  // クーポン×メニュー適合制約（2026年7月15日追加）。coupon_menus に行があるクーポンIDのみ
  // キーを持つマップにして BookingFlow へ渡す（行が無い＝全メニュー適用のため未使用データを
  // 保持しない）。サーバー(src/app/api/booking/route.ts)の fail-closed 判定と同じ意味論を
  // クライアントの disabled/警告表示に反映するための事前情報（孤児だった getCouponMenus を活用）。
  const couponMenuMap: Record<string, string[]> = {};
  await Promise.all(coupons.map(async (c) => {
    const rows = await getCouponMenus(c.id);
    if (rows.length > 0) couponMenuMap[c.id] = rows.map((r) => r.menu_id);
  }));

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
          initialMenuId={searchParams.menu_id}
          initialStaffId={searchParams.staff_id}
          cancelPolicy={cancelPolicy}
          couponMenuMap={couponMenuMap}
        />
      </div>
    </div>
  );
}
