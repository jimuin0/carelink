import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getFacilityBySlug, getFacilityMenus, getFacilityPhotos, getFacilityReviews } from '@/lib/facilities';
import PhotoGallery from '@/components/facility/PhotoGallery';
import FacilityHeader from '@/components/facility/FacilityHeader';
import TabNavigation from '@/components/facility/TabNavigation';
import MenuList from '@/components/facility/MenuList';
import AccessInfo from '@/components/facility/AccessInfo';
import ReviewTab from '@/components/facility/ReviewTab';
import InquiryForm from '@/components/facility/InquiryForm';
import StickyBookingBar from '@/components/facility/StickyBookingBar';
import FavoriteButton from '@/components/facility/FavoriteButton';
import ViewCount from '@/components/facility/ViewCount';
import type { Facility, FacilityMenu } from '@/types';

const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-ruddy-psi.vercel.app';

export const revalidate = 3600;

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
      ...(facility.main_photo_url && { images: [{ url: facility.main_photo_url }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(facility.main_photo_url && { images: [facility.main_photo_url] }),
    },
  };
}

export default async function FacilityPage({ params }: Props) {
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) notFound();

  const [{ menus }, { photos }, { reviews }] = await Promise.all([
    getFacilityMenus(facility.id),
    getFacilityPhotos(facility.id),
    getFacilityReviews(facility.id),
  ]);

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
    {
      key: 'review',
      label: `口コミ(${reviews.length})`,
      content: <ReviewTab facilityId={facility.id} initialReviews={reviews} />,
    },
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
        <nav className="px-4 sm:px-6 pt-3 pb-1" aria-label="パンくずリスト">
          <ol className="flex items-center gap-1.5 text-xs text-gray-400 overflow-x-auto">
            <li><Link href="/search" className="hover:text-sky-600 transition-colors">トップ</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href={`/search?type=${encodeURIComponent(facility.business_type)}`} className="hover:text-sky-600 transition-colors">{facility.business_type}</Link></li>
            <li><span className="mx-1">/</span></li>
            <li className="text-gray-600 font-medium truncate max-w-[200px]">{facility.name}</li>
          </ol>
        </nav>

        <PhotoGallery photos={photos} facilityName={facility.name} />
        <div className="flex items-start justify-between">
          <FacilityHeader facility={facility} />
          <div className="pt-5 pr-4">
            <FavoriteButton facilityId={facility.id} />
          </div>
        </div>
        <TabNavigation tabs={tabs} />

        {/* Contact section */}
        <div id="contact-section" className="px-4 sm:px-6 py-8 border-t border-gray-100">
          <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
            <span className="w-1 h-5 bg-sky-500 rounded-full" />
            お問い合わせ
          </h3>
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
              '@type': 'LocalBusiness',
              name: facility.name,
              description: facility.catch_copy || facility.description,
              address: {
                '@type': 'PostalAddress',
                addressRegion: facility.prefecture,
                addressLocality: facility.city,
                streetAddress: facility.address,
                postalCode: facility.postal_code,
              },
              telephone: facility.phone,
              url: facility.website_url,
              ...(facility.main_photo_url && { image: facility.main_photo_url }),
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
            }),
          }}
        />
        {/* JSON-LD: BreadcrumbList */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'トップ', item: `${SITE_URL}/search` },
                { '@type': 'ListItem', position: 2, name: facility.business_type, item: `${SITE_URL}/search?type=${encodeURIComponent(facility.business_type)}` },
                { '@type': 'ListItem', position: 3, name: facility.name },
              ],
            }),
          }}
        />
      </div>

      <ViewCount facilityId={facility.id} />
      <StickyBookingBar phone={facility.phone} facilityName={facility.name} />
    </div>
  );
}

function TopTab({ facility, featuredMenus }: { facility: Facility; featuredMenus: FacilityMenu[] }) {
  return (
    <div className="space-y-8">
      {/* 施設紹介 */}
      {facility.description && (
        <div>
          <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
            <span className="w-1 h-5 bg-sky-500 rounded-full" />
            こだわり・紹介
          </h3>
          <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">{facility.description}</p>
        </div>
      )}

      {/* おすすめメニュー */}
      {featuredMenus.length > 0 && (
        <div>
          <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
            <span className="w-1 h-5 bg-amber-400 rounded-full" />
            おすすめメニュー
          </h3>
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
          <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
            <span className="w-1 h-5 bg-sky-500 rounded-full" />
            特徴・こだわり
          </h3>
          <div className="flex flex-wrap gap-2">
            {facility.features.map((feature) => (
              <span key={feature} className="text-xs bg-sky-50 text-sky-700 px-3 py-1.5 rounded-full font-medium">
                {feature}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 基本情報（簡易） */}
      <div>
        <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
          <span className="w-1 h-5 bg-sky-500 rounded-full" />
          基本情報
        </h3>
        <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
          <div className="flex">
            <span className="text-gray-500 w-20 shrink-0">住所</span>
            <span>{facility.prefecture}{facility.city}{facility.address}</span>
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
