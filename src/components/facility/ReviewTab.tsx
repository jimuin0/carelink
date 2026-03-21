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

  return (
    <div className="space-y-8">
      {/* Rating summary */}
      {reviews.length > 0 && (
        <div className="flex items-center gap-4 bg-sky-50 rounded-xl p-4">
          <div className="text-center">
            <p className="text-3xl font-bold" style={{ color: 'var(--primary)' }}>{avg}</p>
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
