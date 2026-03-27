import Image from 'next/image';
import Link from 'next/link';
import type { FacilityCardData } from '@/types';
import { SHIMMER_BLUR } from '@/lib/image-utils';

function CardStarRating({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-amber-400 text-sm" aria-hidden="true">{'★'.repeat(Math.floor(rating))}</span>
      <span className="text-sm font-bold text-gray-700">{rating.toFixed(1)}</span>
      <span className="text-xs text-gray-400">({count}件)</span>
    </div>
  );
}

function getTodayHours(hours: FacilityCardData['business_hours']): string | null {
  if (!hours) return null;
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = days[new Date().getDay()];
  const todayHours = hours[today];
  if (!todayHours) return null;
  return `${todayHours.open}〜${todayHours.close}`;
}

interface Props {
  facility: FacilityCardData;
  showBadges?: boolean;
}

export default function FacilityCard({ facility, showBadges = true }: Props) {
  const todayHours = getTodayHours(facility.business_hours);
  const hasCoupons = (facility.coupon_count ?? 0) > 0;

  return (
    <Link href={`/facility/${facility.slug}`} className="facility-card block">
      <div className="relative aspect-[16/10] bg-gray-100">
        {facility.main_photo_url ? (
          <Image
            src={facility.main_photo_url}
            alt={`${facility.name} - ${facility.business_type}`}
            fill
            sizes="(max-width: 640px) 100vw, 50vw"
            className="object-cover"
            placeholder="blur"
            blurDataURL={SHIMMER_BLUR}
          />
        ) : (
          <div className="flex items-center justify-center h-full bg-gradient-to-br from-sky-100 to-sky-50">
            <svg className="w-10 h-10 text-sky-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
        )}
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          <span className="badge badge-primary">{facility.business_type}</span>
          {showBadges && (
            <>
              <span className="badge badge-instant">予約OK</span>
              {hasCoupons && <span className="badge badge-coupon">クーポンあり</span>}
            </>
          )}
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-bold text-lg mb-1 line-clamp-1">{facility.name}</h3>

        <div className="flex items-center gap-3 mb-1">
          {facility.rating_count > 0 && (
            <CardStarRating rating={Number(facility.rating_avg)} count={facility.rating_count} />
          )}
        </div>

        {/* 価格帯 */}
        {facility.min_price != null && (
          <p className="text-sm mb-1">
            <span className="font-bold text-sky-600">
              {facility.min_price === facility.max_price
                ? `¥${facility.min_price.toLocaleString()}`
                : `¥${facility.min_price.toLocaleString()}〜¥${(facility.max_price ?? facility.min_price).toLocaleString()}`}
            </span>
          </p>
        )}

        {facility.catch_copy && (
          <p className="text-gray-600 text-sm mt-1 line-clamp-2">{facility.catch_copy}</p>
        )}

        {/* メタ情報行 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2 text-tiny text-gray-400">
          {facility.seat_count != null && facility.seat_count > 0 && (
            <span>席数{facility.seat_count}</span>
          )}
          {todayHours && <span>{todayHours}</span>}
          {hasCoupons && (
            <span className="text-pink-500 font-medium">クーポン{facility.coupon_count}枚</span>
          )}
          {(facility.photo_count ?? 0) > 0 && (
            <span>写真{facility.photo_count}枚</span>
          )}
          {(facility.menu_count ?? 0) > 0 && (
            <span>メニュー{facility.menu_count}件</span>
          )}
        </div>

        {/* 位置情報 + ポイントバッジ */}
        <div className="flex items-center justify-between mt-2">
          <p className="text-gray-400 text-xs flex items-center gap-1 min-w-0">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="truncate">
              {facility.prefecture} {facility.city}
              {facility.access_info && ` / ${facility.access_info}`}
            </span>
          </p>
          <span className="badge badge-point text-micro shrink-0 ml-2">ポイント</span>
        </div>
      </div>
    </Link>
  );
}
