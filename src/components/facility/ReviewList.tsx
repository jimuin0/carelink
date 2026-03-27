'use client';

import type { FacilityReview } from '@/types';
import StarRating from './StarRating';

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  });
}

const AXES: { key: keyof FacilityReview; label: string }[] = [
  { key: 'rating_skill', label: '技術' },
  { key: 'rating_service', label: '接客' },
  { key: 'rating_atmosphere', label: '雰囲気' },
  { key: 'rating_cleanliness', label: '清潔感' },
  { key: 'rating_explanation', label: '説明' },
];

export default function ReviewList({ reviews }: { reviews: FacilityReview[] }) {
  if (reviews.length === 0) {
    return (
      <p className="text-gray-400 text-center py-8">
        まだ口コミはありません。最初の口コミを投稿してみませんか？
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {reviews.map((review) => {
        const hasAxis = review.rating_skill && review.rating_skill > 0;
        return (
          <div key={review.id} className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center text-sm font-bold">
                  {(review.reviewer_name || 'ユ').charAt(0)}
                </div>
                <div>
                  <p className="font-bold text-sm">{review.reviewer_name}</p>
                  <p className="text-gray-400 text-xs">{formatDate(review.created_at)}</p>
                </div>
              </div>
              <div className="text-right">
                <StarRating value={review.rating} readonly size="sm" />
                <p className="text-xs text-gray-400 mt-0.5">総合 {review.rating.toFixed(1)}</p>
              </div>
            </div>
            {hasAxis && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                {AXES.map(({ key, label }) => {
                  const val = review[key] as number | null;
                  return val ? (
                    <span key={key}>{label} <span className="font-bold text-gray-700">{val}</span></span>
                  ) : null;
                })}
              </div>
            )}
            {review.comment && (
              <p className="text-gray-600 text-sm leading-relaxed mt-2">{review.comment}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
