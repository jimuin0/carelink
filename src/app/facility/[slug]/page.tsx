import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getFacilityBySlug, getFacilityMenus, getFacilityPhotos, getFacilityReviews } from '@/lib/facilities';
import { getPrefectureSlug, getBusinessTypeSlug } from '@/lib/seo-constants';
import { getStaffByFacility } from '@/lib/staff';
import { getCouponsByFacility } from '@/lib/coupons';
import { getCatalogsByFacility } from '@/lib/catalogs';
import PhotoGallery from '@/components/facility/PhotoGallery';
import FacilityHeader from '@/components/facility/FacilityHeader';
import TabNavigation from '@/components/facility/TabNavigation';
import MenuList from '@/components/facility/MenuList';
import AccessInfo from '@/components/facility/AccessInfo';
import ReviewTab from '@/components/facility/ReviewTab';
import InquiryForm from '@/components/facility/InquiryForm';
import StickyBookingBar from '@/components/facility/StickyBookingBar';
import FavoriteButton from '@/components/facility/FavoriteButton';
import ShareButtons from '@/components/facility/ShareButtons';
import SymptomList from '@/components/facility/SymptomList';
import CertificationList from '@/components/facility/CertificationList';
// InsuranceMenuBadge はMenuListコンポーネント内で使用（menu.insurance_covered時に表示）
import { createServiceRoleClient } from '@/lib/supabase-server';
import ViewCount from '@/components/facility/ViewCount';
import StaffList from '@/components/facility/StaffList';
import CouponList from '@/components/facility/CouponList';
import CatalogList from '@/components/facility/CatalogList';
import QASection from '@/components/facility/QASection';
import BusinessStatusBadge from '@/components/facility/BusinessStatusBadge';
import SimilarFacilities from '@/components/facility/SimilarFacilities';
import NearbyFacilities from '@/components/facility/NearbyFacilities';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { SITE_URL } from '@/lib/constants';
import type { Facility, FacilityMenu, FacilityPhoto, FacilityReview, StaffProfile, Coupon, TreatmentCatalog } from '@/types';

export const revalidate = 3600;

export async function generateStaticParams() {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('facility_profiles')
    .select('slug')
    .eq('status', 'published');
  return (data || []).map((f) => ({ slug: f.slug }));
}

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) return { title: 'ページが見つかりません | CareLink' };

  const title = `${facility.name} | ${facility.business_type} | CareLink`;
  const description = facility.catch_copy || `${facility.prefecture}${facility.city}の${facility.business_type}「${facility.name}」のメニュー・料金・アクセス情報`;

  const url = `${SITE_URL}/facility/${params.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: 'website',
      url,
      siteName: 'CareLink',
      images: [{
        url: `${SITE_URL}/api/og?title=${encodeURIComponent(facility.name)}&subtitle=${encodeURIComponent(facility.business_type + ' | ' + facility.prefecture + facility.city)}${facility.rating_avg ? '&rating=' + facility.rating_avg.toFixed(1) : ''}${facility.rating_count ? '&reviews=' + facility.rating_count : ''}`,
        width: 1200,
        height: 630,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${SITE_URL}/api/og?title=${encodeURIComponent(facility.name)}&subtitle=${encodeURIComponent(facility.business_type + ' | ' + facility.prefecture + facility.city)}${facility.rating_avg ? '&rating=' + facility.rating_avg.toFixed(1) : ''}${facility.rating_count ? '&reviews=' + facility.rating_count : ''}`],
    },
  };
}

export default async function FacilityPage({ params }: Props) {
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) notFound();

  const results = await Promise.allSettled([
    getFacilityMenus(facility.id),
    getFacilityPhotos(facility.id),
    getFacilityReviews(facility.id),
    getStaffByFacility(facility.id),
    getCouponsByFacility(facility.id),
    getCatalogsByFacility(facility.id),
  ]);
  const queryNames = ['menus', 'photos', 'reviews', 'staff', 'coupons', 'catalogs'];
  results.forEach((r, i) => {
    if (r.status === 'rejected') Sentry.captureException(r.reason, { tags: { feature: 'facility-detail', query: queryNames[i], slug: params.slug } });
  });
  const menus: FacilityMenu[] = results[0].status === 'fulfilled' ? results[0].value.menus : [];
  const photos: FacilityPhoto[] = results[1].status === 'fulfilled' ? results[1].value.photos : [];
  const reviews: FacilityReview[] = results[2].status === 'fulfilled' ? results[2].value.reviews : [];
  const staff: StaffProfile[] = results[3].status === 'fulfilled' ? results[3].value : [];
  const coupons: Coupon[] = results[4].status === 'fulfilled' ? results[4].value : [];
  const catalogs: TreatmentCatalog[] = results[5].status === 'fulfilled' ? results[5].value : [];

  // 鍼灸院向けデータ取得（症状・資格）
  const isAcupuncture = ['鍼灸院・整骨院', '整骨院・接骨院', '整体院'].some(t => facility.business_type?.includes(t));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let facilitySymptoms: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let certifications: any[] = [];
  if (isAcupuncture) {
    const adminSupa = createServiceRoleClient();
    const [sympRes, certRes] = await Promise.all([
      adminSupa.from('facility_symptoms').select('symptom_id, description, symptoms(name, slug, category)').eq('facility_id', facility.id),
      adminSupa.from('facility_certifications').select('*').eq('facility_id', facility.id).order('sort_order'),
    ]);
    facilitySymptoms = sympRes.data || [];
    certifications = certRes.data || [];
  }

  const featuredMenus = menus.filter((m) => m.is_featured).slice(0, 3);

  const tabs = [
    {
      key: 'top',
      label: 'トップ',
      content: <TopTab facility={facility} featuredMenus={featuredMenus} />,
    },
    {
      key: 'menu',
      label: 'メニュー',
      content: <MenuList menus={menus} />,
    },
    ...(staff.length > 0 ? [{
      key: 'staff',
      label: `スタッフ(${staff.length})`,
      content: <StaffList staff={staff} facilitySlug={params.slug} />,
    }] : []),
    ...(catalogs.length > 0 ? [{
      key: 'catalog',
      label: `カタログ(${catalogs.length})`,
      content: <CatalogList catalogs={catalogs} staff={staff} menus={menus} />,
    }] : []),
    ...(coupons.length > 0 ? [{
      key: 'coupon',
      label: `クーポン(${coupons.length})`,
      content: <CouponList coupons={coupons} menus={menus} />,
    }] : []),
    {
      key: 'qa',
      label: 'Q&A',
      content: <QASection facilityId={facility.id} />,
    },
    {
      key: 'review',
      label: `口コミ(${reviews.length})`,
      content: <ReviewTab facilityId={facility.id} facilitySlug={facility.slug} facilityName={facility.name} initialReviews={reviews} googlePlaceId={facility.gbp_place_id} />,
    },
    ...((facilitySymptoms.length > 0 || certifications.length > 0) ? [{
      key: 'medical',
      label: '施術情報',
      content: (
        <div className="space-y-6 py-4">
          {facilitySymptoms.length > 0 && <SymptomList symptoms={facilitySymptoms} />}
          {certifications.length > 0 && <CertificationList certifications={certifications} />}
        </div>
      ),
    }] : []),
    {
      key: 'access',
      label: 'アクセス',
      content: <AccessInfo facility={facility} />,
    },
  ];

  return (
    <div className="bg-gray-50 min-h-screen pb-20">
      <div className="max-w-4xl mx-auto bg-white shadow-sm">
        {/* パンくずリスト */}
        {(() => {
          const prefSlug = getPrefectureSlug(facility.prefecture);
          const typeSlug = getBusinessTypeSlug(facility.business_type);
          return (
            <nav className="px-4 sm:px-6 pt-3 pb-1" aria-label="パンくずリスト">
              <ol className="flex items-center gap-1.5 text-xs text-gray-400 overflow-x-auto">
                <li><Link href="/" className="hover:text-sky-600 transition-colors">トップ</Link></li>
                <li><span className="mx-1">/</span></li>
                {prefSlug && (
                  <>
                    <li><Link href={`/${prefSlug}`} className="hover:text-sky-600 transition-colors">{facility.prefecture}</Link></li>
                    <li><span className="mx-1">/</span></li>
                  </>
                )}
                {prefSlug && typeSlug ? (
                  <>
                    <li><Link href={`/${prefSlug}/${typeSlug}`} className="hover:text-sky-600 transition-colors">{facility.business_type}</Link></li>
                    <li><span className="mx-1">/</span></li>
                  </>
                ) : (
                  <>
                    <li><Link href={`/search?type=${encodeURIComponent(facility.business_type)}`} className="hover:text-sky-600 transition-colors">{facility.business_type}</Link></li>
                    <li><span className="mx-1">/</span></li>
                  </>
                )}
                <li className="text-gray-600 font-medium truncate max-w-[200px]">{facility.name}</li>
              </ol>
            </nav>
          );
        })()}

        <PhotoGallery photos={photos} facilityName={facility.name} />
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <FacilityHeader facility={facility} />
            <div className="px-4 sm:px-6 pb-2 flex flex-wrap items-center gap-2">
              <BusinessStatusBadge businessHours={facility.business_hours} regularHoliday={facility.regular_holiday} />
              {menus.length > 0 && (() => {
                const prices = menus.filter(m => m.price != null && m.price > 0).map(m => m.price!);
                if (prices.length === 0) return null;
                const min = Math.min(...prices);
                const max = Math.max(...prices);
                return (
                  <span className="text-sm font-bold text-sky-600">
                    {min === max ? `¥${min.toLocaleString()}` : `¥${min.toLocaleString()}〜¥${max.toLocaleString()}`}
                  </span>
                );
              })()}
              {facility.seat_count != null && facility.seat_count > 0 && (
                <span className="text-xs text-gray-400">席数{facility.seat_count}</span>
              )}
            </div>
          </div>
          <div className="pt-5 pr-4 flex items-center gap-2">
            <ShareButtons url={`${SITE_URL}/facility/${params.slug}`} title={`${facility.name} | CareLink`} />
            <FavoriteButton facilityId={facility.id} />
          </div>
        </div>

        {/* クーポンプレビュー（ファーストビュー） */}
        {coupons.length > 0 && (
          <div className="px-4 sm:px-6 pb-3">
            <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-xl p-3 border border-red-100">
              <p className="text-xs font-bold text-red-500 mb-2 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm2.5 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6.207.293a1 1 0 00-1.414 0l-6 6a1 1 0 101.414 1.414l6-6a1 1 0 000-1.414zM12.5 10a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" clipRule="evenodd" /></svg>
                クーポンあり
              </p>
              <div className="space-y-1.5">
                {coupons.slice(0, 3).map((coupon) => (
                  <div key={coupon.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0 mr-2">
                      <p className="text-xs font-bold truncate">{coupon.name}</p>
                    </div>
                    <span className="text-sm font-bold text-red-500 shrink-0">
                      {coupon.discount_type === 'special_price' && coupon.special_price !== null
                        ? `¥${coupon.special_price.toLocaleString()}`
                        : coupon.discount_type === 'percentage' && coupon.discount_value !== null
                        ? `${coupon.discount_value}%OFF`
                        : coupon.discount_type === 'fixed' && coupon.discount_value !== null
                        ? `¥${coupon.discount_value.toLocaleString()}OFF`
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
              {coupons.length > 3 && (
                <p className="text-xs text-center text-sky-600 font-medium mt-2">
                  他{coupons.length - 3}件のクーポン
                </p>
              )}
            </div>
          </div>
        )}

        <TabNavigation tabs={tabs} />

        {/* 類似施設 (ストリーミング) */}
        <Suspense fallback={
          <div className="px-4 sm:px-6 py-8 border-t border-gray-100 animate-pulse">
            <div className="h-6 w-48 bg-gray-200 rounded mb-4" />
            <div className="grid sm:grid-cols-2 gap-4">
              {[0,1].map(i => <div key={i} className="h-40 bg-gray-100 rounded-2xl" />)}
            </div>
          </div>
        }>
          <SimilarFacilities facilityId={facility.id} businessType={facility.business_type} prefecture={facility.prefecture} />
        </Suspense>

        {/* 近くのサロン */}
        <Suspense fallback={null}>
          <NearbyFacilities facilityId={facility.id} prefecture={facility.prefecture} city={facility.city} />
        </Suspense>

        {/* Contact section */}
        <div id="contact-section" className="px-4 sm:px-6 py-8 border-t border-gray-100">
          <h2 className="text-lg font-bold mb-2 flex items-center gap-2">
            <span className="w-1 h-5 bg-sky-500 rounded-full" />
            お問い合わせ
          </h2>
          <p className="text-gray-500 text-sm mb-4">
            ご予約・ご質問は、お電話またはフォームからお気軽にどうぞ。
          </p>
          {facility.phone && (
            <a
              href={`tel:${facility.phone}`}
              className="inline-flex items-center gap-2 text-sky-600 font-bold text-lg hover:underline mb-6"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              {facility.phone}
            </a>
          )}
          <InquiryForm facilityId={facility.id} facilityName={facility.name} />
        </div>

        {/* JSON-LD: LocalBusiness */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': (() => {
                const bt = facility.business_type || '';
                const types: string[] = ['LocalBusiness'];
                if (['クリニック', '鍼灸', '整骨', '整体', '訪問看護', 'デイサービス', '介護'].some(t => bt.includes(t))) {
                  types.push('MedicalBusiness');
                }
                if (['美容室', '理容', 'エステ', 'まつエク', 'ネイル', 'サロン'].some(t => bt.includes(t))) {
                  types.push('BeautySalon');
                }
                return types;
              })(),
              name: facility.name,
              description: facility.catch_copy || facility.description,
              ...(facility.updated_at && { dateModified: facility.updated_at.split('T')[0] }),
              address: {
                '@type': 'PostalAddress',
                addressRegion: facility.prefecture,
                addressLocality: facility.city,
                streetAddress: facility.address,
                postalCode: facility.postal_code,
              },
              telephone: facility.phone,
              url: facility.website_url,
              ...((() => {
                const allImages = [
                  facility.main_photo_url,
                  ...photos.map(p => p.photo_url).filter(Boolean),
                ].filter(Boolean) as string[];
                if (allImages.length === 0) return {};
                return { image: allImages.length === 1 ? allImages[0] : allImages };
              })()),
              currenciesAccepted: 'JPY',
              paymentAccepted: ['現金', ...(facility.credit_card ? ['クレジットカード'] : [])].join(', '),
              ...(facility.features && facility.features.length > 0 && {
                amenityFeature: facility.features.map((f: string) => ({
                  '@type': 'LocationFeatureSpecification',
                  name: f,
                  value: true,
                })),
              }),
              ...(facility.rating_count > 0 && {
                aggregateRating: {
                  '@type': 'AggregateRating',
                  ratingValue: facility.rating_avg,
                  reviewCount: facility.rating_count,
                },
              }),
              ...(facility.latitude && facility.longitude && {
                geo: {
                  '@type': 'GeoCoordinates',
                  latitude: facility.latitude,
                  longitude: facility.longitude,
                },
              }),
              ...((() => {
                const priced = menus.filter(m => m.price != null && m.price > 0);
                if (priced.length === 0) return {};
                const minP = Math.min(...priced.map(m => m.price!));
                const maxP = Math.max(...priced.map(m => m.price!));
                return { priceRange: `¥${minP.toLocaleString()}〜¥${maxP.toLocaleString()}` };
              })()),
              ...(facility.business_hours && {
                openingHoursSpecification: Object.entries(facility.business_hours as Record<string, { open: string; close: string } | null>)
                  .filter(([, v]) => v !== null)
                  .map(([day, hours]) => ({
                    '@type': 'OpeningHoursSpecification',
                    dayOfWeek: { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }[day],
                    opens: hours!.open,
                    closes: hours!.close,
                  })),
              }),
              ...(facility.website_url && {
                sameAs: [facility.website_url],
              }),
              ...(menus.length > 0 && {
                hasMenu: {
                  '@type': 'Menu',
                  hasMenuSection: [{
                    '@type': 'MenuSection',
                    name: 'メニュー',
                    hasMenuItem: menus.slice(0, 5).map(m => ({
                      '@type': 'MenuItem',
                      name: m.name,
                      ...(m.price != null && m.price > 0 && {
                        offers: { '@type': 'Offer', price: m.price, priceCurrency: 'JPY' },
                      }),
                    })),
                  }],
                },
              }),
              ...(reviews.length > 0 && {
                review: reviews.slice(0, 3).map(r => ({
                  '@type': 'Review',
                  author: { '@type': 'Person', name: r.reviewer_name },
                  reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 },
                  ...(r.comment && { reviewBody: r.comment }),
                  datePublished: r.created_at.split('T')[0],
                })),
              }),
            }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
          }}
        />
        {/* JSON-LD: BreadcrumbList */}
        {(() => {
          const pSlug = getPrefectureSlug(facility.prefecture);
          const tSlug = getBusinessTypeSlug(facility.business_type);
          const items: { '@type': string; position: number; name: string; item?: string }[] = [
            { '@type': 'ListItem', position: 1, name: 'トップ', item: SITE_URL },
          ];
          if (pSlug) {
            items.push({ '@type': 'ListItem', position: 2, name: facility.prefecture, item: `${SITE_URL}/${pSlug}` });
            if (tSlug) {
              items.push({ '@type': 'ListItem', position: 3, name: facility.business_type, item: `${SITE_URL}/${pSlug}/${tSlug}` });
              items.push({ '@type': 'ListItem', position: 4, name: facility.name });
            } else {
              items.push({ '@type': 'ListItem', position: 3, name: facility.name });
            }
          } else {
            items.push({ '@type': 'ListItem', position: 2, name: facility.business_type, item: `${SITE_URL}/search?type=${encodeURIComponent(facility.business_type)}` });
            items.push({ '@type': 'ListItem', position: 3, name: facility.name });
          }
          return (
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  '@context': 'https://schema.org',
                  '@type': 'BreadcrumbList',
                  itemListElement: items,
                }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
              }}
            />
          );
        })()}
        {/* JSON-LD: Individual Reviews */}
        {reviews.length > 0 && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(
                reviews.slice(0, 10).map((r) => ({
                  '@context': 'https://schema.org',
                  '@type': 'Review',
                  itemReviewed: { '@type': 'LocalBusiness', name: facility.name },
                  reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 },
                  author: { '@type': 'Person', name: r.reviewer_name || '匿名' },
                  reviewBody: r.comment,
                  datePublished: r.created_at?.split('T')[0],
                }))
              ).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
            }}
          />
        )}
        {/* JSON-LD: Offers (Menus) */}
        {menus.length > 0 && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'OfferCatalog',
                name: `${facility.name}のメニュー`,
                itemListElement: menus.slice(0, 20).map((m) => ({
                  '@type': 'Offer',
                  name: m.name,
                  ...(m.description && { description: m.description }),
                  ...(m.price !== null && {
                    price: m.price,
                    priceCurrency: 'JPY',
                  }),
                  availability: 'https://schema.org/InStock',
                })),
              }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
            }}
          />
        )}
        {/* JSON-LD: Staff as Person */}
        {staff.length > 0 && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(
                staff.map((s) => ({
                  '@context': 'https://schema.org',
                  '@type': 'Person',
                  name: s.name,
                  jobTitle: s.position,
                  worksFor: { '@type': 'LocalBusiness', name: facility.name },
                  ...(s.photo_url && { image: s.photo_url }),
                  ...(s.bio && { description: s.bio }),
                }))
              ).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
            }}
          />
        )}
      </div>

      <ViewCount facilityId={facility.id} facilityName={facility.name} facilitySlug={params.slug} mainPhotoUrl={facility.main_photo_url} businessType={facility.business_type} />
      <StickyBookingBar phone={facility.phone} facilityName={facility.name} facilitySlug={params.slug} facilityId={facility.id} />
    </div>
  );
}

function TopTab({ facility, featuredMenus }: { facility: Facility; featuredMenus: FacilityMenu[] }) {
  return (
    <div className="space-y-8">
      {/* 施設紹介 */}
      {facility.description && (
        <div>
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <span className="w-1 h-5 bg-sky-500 rounded-full" />
            こだわり・紹介
          </h2>
          <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">{facility.description}</p>
        </div>
      )}

      {/* おすすめメニュー */}
      {featuredMenus.length > 0 && (
        <div>
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <span className="w-1 h-5 bg-amber-400 rounded-full" />
            おすすめメニュー
          </h2>
          <div className="space-y-3">
            {featuredMenus.map((menu) => (
              <div key={menu.id} className="flex items-start justify-between p-4 bg-amber-50 rounded-xl border border-amber-100">
                <div className="flex-1 mr-4">
                  <p className="font-bold text-sm">{menu.name}</p>
                  {menu.description && <p className="text-gray-500 text-xs mt-1">{menu.description}</p>}
                </div>
                <div className="text-right">
                  <p className="font-bold text-sm text-sky-500">
                    {menu.price_note || (menu.price !== null ? `¥${menu.price.toLocaleString()}` : '-')}
                  </p>
                  {menu.duration_minutes && (
                    <p className="text-gray-400 text-xs mt-0.5">{menu.duration_minutes}分</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 特徴タグ */}
      {facility.features && facility.features.length > 0 && (
        <div>
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <span className="w-1 h-5 bg-sky-500 rounded-full" />
            特徴・こだわり
          </h2>
          <div className="flex flex-wrap gap-2">
            {facility.features.map((feature) => (
              <Link key={feature} href={`/search?keyword=${encodeURIComponent(feature)}`} className="text-xs bg-sky-50 text-sky-700 px-3 py-1.5 rounded-full font-medium hover:bg-sky-100 transition-colors">
                {feature}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 基本情報（簡易） */}
      <div>
        <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
          <span className="w-1 h-5 bg-sky-500 rounded-full" />
          基本情報
        </h2>
        <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
          <div className="flex">
            <span className="text-gray-500 w-20 shrink-0">住所</span>
            <div className="flex items-center gap-2 flex-wrap">
              <span>{facility.prefecture}{facility.city}{facility.address}</span>
              <a
                href={facility.gbp_place_id
                  ? `https://www.google.com/maps/place/?q=place_id:${facility.gbp_place_id}`
                  : `https://www.google.com/maps/search/${encodeURIComponent(`${facility.prefecture}${facility.city}${facility.address}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline shrink-0"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                地図を見る
              </a>
            </div>
          </div>
          {facility.phone && (
            <div className="flex">
              <span className="text-gray-500 w-20 shrink-0">電話</span>
              <a href={`tel:${facility.phone}`} className="text-sky-600 hover:underline">{facility.phone}</a>
            </div>
          )}
          {facility.access_info && (
            <div className="flex">
              <span className="text-gray-500 w-20 shrink-0">アクセス</span>
              <span>{facility.access_info}</span>
            </div>
          )}
          {facility.regular_holiday && (
            <div className="flex">
              <span className="text-gray-500 w-20 shrink-0">定休日</span>
              <span>{facility.regular_holiday}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
