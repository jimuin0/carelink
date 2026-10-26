'use client';

import { formatBusinessDay } from '@/lib/business-hours';
import { isCardBookingReady } from '@/lib/facility-publish-gate';
import Image from 'next/image';
import Link from '@/components/BrowseLink';
import type { FacilityCardData } from '@/types';
import { SHIMMER_BLUR, cardUrl } from '@/lib/image-utils';
import { formatFacilityLocality } from '@/lib/facility-location';
import { businessTypeLabel } from '@/lib/business-type-label';

function CardStarRating({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-1" aria-label={`${rating.toFixed(1)}点、${count}件のレビュー`}>
      <span className="text-amber-400 text-sm" aria-hidden="true">{'★'.repeat(Math.floor(rating))}</span>
      <span className="text-sm font-bold text-gray-700">{rating.toFixed(1)}</span>
      <span className="text-xs text-gray-500">({count}件)</span>
    </div>
  );
}

function getTodayHours(hours: FacilityCardData['business_hours']): string | null {
  if (!hours) return null;
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  // Keep the Japanese business day identical during SSR and hydration.
  const today = days[new Date(Date.now() + 9 * 3_600_000).getUTCDay()];
  const todayHours = hours[today];
  if (!todayHours) return null;
  return formatBusinessDay(todayHours);
}

interface Props {
  facility: FacilityCardData;
  showBadges?: boolean;
  monthlyBookings?: number;
  isAvailable?: boolean;
  priority?: boolean;
}

export default function FacilityCard({ facility, showBadges = true, monthlyBookings, isAvailable, priority = false }: Props) {
  const todayHours = getTodayHours(facility.business_hours);
  const hasCoupons = (facility.coupon_count ?? 0) > 0;
  const bookingReady = isCardBookingReady(facility);

  return (
    <Link href={`/facility/${facility.slug}`} className="facility-card block">
      <div className="relative aspect-16/10 bg-gray-100">
        {facility.main_photo_url ? (
          <Image
            src={cardUrl(facility.main_photo_url)}
            alt={`${facility.name} - ${businessTypeLabel(facility.business_type)}`}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
            placeholder="blur"
            blurDataURL={SHIMMER_BLUR}
            priority={priority}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full bg-linear-to-br from-sky-50 via-sky-100 to-indigo-50">
            <div className="w-12 h-12 rounded-full bg-sky-200/50 flex items-center justify-center mb-1.5">
              <span className="text-xl font-bold text-sky-400">{facility.name.charAt(0)}</span>
            </div>
            {/* sky-800 #075985 は背景のグラデーション（sky-50〜sky-100〜indigo-50）の上で 6.59:1 以上。sky-300 は 1.45:1 だった。 */}
            <p className="text-sky-800 text-xs">写真未登録</p>
          </div>
        )}
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          <span className="badge badge-primary">{businessTypeLabel(facility.business_type)}</span>
          {showBadges && (
            <>
              {bookingReady && <span className="badge badge-instant">予約OK</span>}
              {hasCoupons && <span className="badge badge-coupon">クーポンあり</span>}
              {monthlyBookings != null && monthlyBookings > 0 && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-bold rounded-full">
                  今月{monthlyBookings}件予約
                </span>
              )}
              {/* 空きの表示はネット予約を受け付ける施設だけ。掲載だけの施設に「空きなし」と出すと、
                  ネット予約をしていないのではなく満席だと伝えてしまう。 */}
              {bookingReady && isAvailable === true && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">
                  空きあり
                </span>
              )}
              {bookingReady && isAvailable === false && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                  空きなし
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-bold text-lg mb-1 line-clamp-1">{facility.name}</h3>

        <div className="flex items-center gap-3 mb-1 flex-wrap">
          {facility.rating_count > 0 && (
            <CardStarRating rating={Number(facility.rating_avg)} count={facility.rating_count} />
          )}
          {(facility.google_review_count ?? 0) > 0 && (
            <div className="flex items-center gap-1" aria-label={`Google評価${Number(facility.google_rating).toFixed(1)}点、${facility.google_review_count}件`}>
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span className="text-xs font-bold text-gray-700">{Number(facility.google_rating).toFixed(1)}</span>
              <span className="text-xs text-gray-500">({facility.google_review_count})</span>
            </div>
          )}
        </div>

        {/* 価格帯。価格は濃い文字の太字で出す（色に意味を持たせない）。
            取り消し線は「割引前の価格」、赤は「割引後のクーポン価格」だけに使う。施設の価格帯は
            どちらでもないので、クーポンがあっても線を引かない（以前は最安値に線を引き
            「クーポン価格あり」と赤で出していた＝定価が値下げされたように見えていた）。
            クーポンの有無はバッジと「クーポンN枚」で伝える。 */}
        {facility.min_price != null && (
          <p className="text-sm mb-1 font-bold text-gray-900" data-testid="facility-card-price">
            {facility.min_price === facility.max_price || facility.max_price == null
              ? `¥${facility.min_price.toLocaleString()}`
              : `¥${facility.min_price.toLocaleString()}〜¥${facility.max_price.toLocaleString()}`}
          </p>
        )}

        {facility.catch_copy && (
          <p className="text-gray-600 text-sm mt-1 line-clamp-2">{facility.catch_copy}</p>
        )}

        {/* メタ情報行 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2 text-xs text-gray-500">
          {facility.seat_count != null && facility.seat_count > 0 && (
            <span>席数{facility.seat_count}</span>
          )}
          {todayHours && <span>{todayHours}</span>}
          {hasCoupons && (
            <span className="text-pink-700 font-medium">クーポン{facility.coupon_count}枚</span>
          )}
          {(facility.photo_count ?? 0) > 0 && (
            <span>写真{facility.photo_count}枚</span>
          )}
          {(facility.menu_count ?? 0) > 0 && (
            <span>メニュー{facility.menu_count}件</span>
          )}
        </div>

        {/* 位置情報 */}
        <div className="mt-2">
          <p className="text-gray-500 text-xs flex items-center gap-1 min-w-0">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="truncate">
              {facility.prefecture} {formatFacilityLocality(facility.prefecture, facility.city)}
              {facility.access_info && ` / ${facility.access_info}`}
            </span>
          </p>
        </div>
      </div>
    </Link>
  );
}
