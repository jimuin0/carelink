'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { FacilityReview } from '@/types';
import ReviewList from './ReviewList';
import ReviewForm from './ReviewForm';
import StarRating from './StarRating';

interface Props {
  facilityId: string;
  initialReviews: FacilityReview[];
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

export default function ReviewTab({ facilityId, initialReviews }: Props) {
  const [reviews, setReviews] = useState(initialReviews);

  const refreshReviews = async () => {
    const { data } = await supabase
      .from('facility_reviews')
      .select('*')
      .eq('facility_id', facilityId)
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    if (data) setReviews(data);
  };

  const avg = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : '0.0';

  const hasAxisData = reviews.some((r) => r.rating_skill && r.rating_skill > 0);

  return (
    <div className="space-y-8">
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

      {/* Review list */}
      <ReviewList reviews={reviews} />

      {/* Divider */}
      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <span className="w-1 h-5 bg-sky-500 rounded-full" />
          口コミを投稿する
        </h3>
        <ReviewForm facilityId={facilityId} onReviewSubmitted={refreshReviews} />
      </div>
    </div>
  );
}
