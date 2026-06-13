'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { FacilityReview } from '@/types';
import ReviewList from './ReviewList';
import ReviewForm from './ReviewForm';
import StarRating from './StarRating';
import ReviewSummary from './ReviewSummary';

interface Props {
  facilityId: string;
  facilitySlug?: string;
  facilityName?: string;
  initialReviews: FacilityReview[];
  googlePlaceId?: string | null;
}

const AXES: { key: keyof FacilityReview; label: string }[] = [
  { key: 'rating_skill', label: '技術' },
  { key: 'rating_service', label: '接客' },
  { key: 'rating_atmosphere', label: '雰囲気' },
  { key: 'rating_cleanliness', label: '清潔感' },
  { key: 'rating_explanation', label: '施術の説明' },
];

function axisAvg(reviews: FacilityReview[], key: keyof FacilityReview): number {
  const vals = reviews.map((r) => r[key]).filter((v): v is number => typeof v === 'number' && v > 0);
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

export default function ReviewTab({ facilityId, facilitySlug, facilityName, initialReviews, googlePlaceId }: Props) {
  const [reviews, setReviews] = useState(initialReviews);

  const refreshReviews = async () => {
    // 投稿後の再取得（補助）。失敗時も既存の表示を維持し、サーバ保存済みのため再読込で反映される
    // （空状態への偽装は起きない＝initialReviews を保持）。
    // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
    const { data } = await supabase
      .from('public_reviews' as 'facility_reviews')
      .select('*')
      .eq('facility_id', facilityId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setReviews(data as FacilityReview[]);
  };

  const avg = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : '0.0';

  const hasAxisData = reviews.some((r) => r.rating_skill && r.rating_skill > 0);

  return (
    <div className="space-y-8">
      {/* Empty state */}
      {reviews.length === 0 && (
        <div className="text-center py-10 bg-gray-50 rounded-xl">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-gray-500 text-sm font-medium">まだ口コミがありません</p>
          <p className="text-gray-400 text-xs mt-1">この施設を利用された方の最初の口コミをお待ちしています</p>
        </div>
      )}

      {/* Rating summary */}
      {reviews.length > 0 && (
        <div className="bg-sky-50 rounded-xl p-4 space-y-4">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-3xl font-bold text-sky-500">{avg}</p>
              <StarRating value={Math.round(Number(avg))} readonly size="sm" />
              <p className="text-gray-500 text-xs mt-1">{reviews.length}件の口コミ</p>
            </div>
            <div className="flex-1 space-y-1">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = reviews.filter((r) => r.rating === star).length;
                const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                return (
                  <div key={star} className="flex items-center gap-2 text-xs">
                    <span className="w-4 text-right text-gray-500">{star}</span>
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-6 text-right text-gray-400">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 5-axis breakdown */}
          {hasAxisData && (
            <div className="border-t border-sky-100 pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {AXES.map(({ key, label }) => {
                  const val = axisAvg(reviews, key);
                  return (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      <span className="w-[5em] text-gray-600 shrink-0">{label}</span>
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-sky-400 rounded-full transition-all" style={{ width: `${(val / 5) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right font-bold text-sky-600">{val > 0 ? val.toFixed(1) : '-'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Review Summary */}
      <ReviewSummary reviews={reviews} facilityId={facilityId} />

      {/* Review list */}
      <ReviewList reviews={reviews} />

      {/* Divider */}
      <div className="border-t border-gray-200 pt-6 space-y-6">
        {/* Google口コミボタン */}
        {googlePlaceId && (
          <div className="bg-gradient-to-r from-sky-50 to-indigo-50 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-bold text-gray-800">Googleにも口コミを書いてみませんか？</p>
              <p className="text-xs text-gray-500 mt-0.5">Googleの口コミは施設の集客に大きく貢献します</p>
            </div>
            <a
              href={`https://search.google.com/local/writereview?placeid=${googlePlaceId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors shrink-0"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Googleで口コミを書く
            </a>
          </div>
        )}

        <div>
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-sky-500 rounded-full" />
            口コミを投稿する
          </h3>
          <ReviewForm facilityId={facilityId} facilitySlug={facilitySlug} facilityName={facilityName} onReviewSubmitted={refreshReviews} />
        </div>
      </div>
    </div>
  );
}
