import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFacilityBySlug, getFacilityMenus, getFacilityCancelPolicy } from '@/lib/facilities';
import { getStaffByFacility, getMenuStaffByMenuIds } from '@/lib/staff';
import { getActiveCouponsByFacility, getCouponMenus } from '@/lib/coupons';
import { buildMenuStaffMap } from '@/lib/menu-staff';
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
  // ルート layout の title.template '%s | CareLink' が自動付与するため、
  // metadata.title には「| CareLink」を付けない（付けると二重化する）。openGraph.title はテンプレ非適用のため付与する。
  const title = `予約 | ${facility.name}`;
  const description = `${facility.name}のオンライン予約ページ`;
  return {
    title,
    description,
    openGraph: { title: `${title} | CareLink`, description },
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
    getActiveCouponsByFacility(facility.id),
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

  // メニュー担当スタッフ制(menu_staff・2026年7月15日追加)。coupon_menus と同型の意味論＝
  // 行があるメニューは担当スタッフ限定・行が無いメニューは全スタッフ対応（本番は現状全メニュー
  // 0行のため挙動変化ゼロ）。menuId -> 担当スタッフID配列 のマップを BookingFlow へ渡し、
  // 指名候補の絞込・自動解除・おまかせ時の空き集計対象の絞込に使う。
  const menuStaffRows = await getMenuStaffByMenuIds(menus.map((m) => m.id));
  const menuStaffMap = buildMenuStaffMap(menuStaffRows);

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
          menuStaffMap={menuStaffMap}
        />
      </div>
    </div>
  );
}
