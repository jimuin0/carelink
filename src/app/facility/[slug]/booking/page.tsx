import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFacilityBySlug, getFacilityMenus, getFacilityCancelPolicy } from '@/lib/facilities';
import { getBookableStaffByFacility, getMenuStaffByMenuIds } from '@/lib/staff';
import { getActiveCouponsByFacility, getCouponMenus } from '@/lib/coupons';
import { buildMenuStaffMap } from '@/lib/menu-staff';
import BookingFlow from '@/components/booking/BookingFlow';
import { isHomeVisitOnly } from '@/lib/home-visit';
import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { checkBookingReadiness } from '@/lib/facility-publish-gate';
import { isDialablePhone } from '@/lib/facility-contact';

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

  const preparation = await checkBookingReadiness(createServerSupabaseClient(), facility.id);
  if (preparation.error) throw new Error('Online booking preparation lookup failed');
  if (!preparation.readiness.ready) return <BookingNotReady slug={params.slug} name={facility.name} phone={facility.phone} />;

  const [staff, { menus }, coupons, cancelPolicy] = await Promise.all([
    // 指名候補は勤務時間のあるスタッフだけ（勤務の無い人を選ぶと毎日「満枠」になる）。
    getBookableStaffByFacility(facility.id),
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
          facility={{ id: facility.id, slug: params.slug, name: facility.name, homeVisitOnly: isHomeVisitOnly(facility.features) }}
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

/**
 * ネット予約の準備が整っていない店舗の予約ページ（2026年10月23日）。
 *
 * 以前は装飾の無い素の文章だけで、電話番号が無い（または tel: にできない）店舗では連絡手段が
 * 1 つも出ず、来訪者は行き止まりになっていた。予約ページと同じ枠で見せ、電話番号は店舗ページと同じ
 * 判定（isDialablePhone）を通ったときだけ出し、店舗ページのお問い合わせフォームへの導線は必ず出す。
 */
function BookingNotReady({ slug, name, phone }: { slug: string; name: string; phone?: string | null }) {
  const dialable = isDialablePhone(phone);
  return (
    <div className="bg-gray-50 min-h-screen">
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold mb-2">{name}</h1>
        <p className="text-sm text-gray-500 mb-6">オンライン予約</p>
        <section className="bg-white rounded-xl border border-gray-200 p-6" aria-labelledby="booking-not-ready-heading">
          <h2 id="booking-not-ready-heading" className="text-base font-bold text-gray-900 mb-2">ネット予約は準備中です</h2>
          <p className="text-sm text-gray-600 mb-5">
            ご予約については、{dialable ? 'お電話または' : ''}お問い合わせフォームから店舗へ直接お問い合わせください。
          </p>
          <div className="flex flex-col gap-3">
            {dialable && (
              <a href={`tel:${phone}`} className="btn-primary text-center">
                店舗に電話する
              </a>
            )}
            {dialable && <p className="text-sm text-gray-700 text-center -mt-1">{phone}</p>}
            <Link
              href={`/facility/${slug}#contact-section`}
              className="text-center rounded-lg border border-sky-700 px-4 py-3 text-sm font-bold text-sky-700 hover:bg-sky-50"
            >
              お問い合わせフォームで問い合わせる
            </Link>
          </div>
        </section>
        <p className="mt-6 text-center">
          <Link href={`/facility/${slug}`} className="text-sm text-sky-700 hover:underline">店舗情報に戻る</Link>
        </p>
      </main>
    </div>
  );
}
