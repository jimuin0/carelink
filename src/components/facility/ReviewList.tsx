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
      {reviews.map((review) => (
        <div key={review.id} className="bg-gray-50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center text-sm font-bold">
                {review.reviewer_name.charAt(0)}
              </div>
              <div>
                <p className="font-bold text-sm">{review.reviewer_name}</p>
                <p className="text-gray-400 text-xs">{formatDate(review.created_at)}</p>
              </div>
            </div>
            <StarRating value={review.rating} readonly size="sm" />
          </div>
          {review.comment && (
            <p className="text-gray-600 text-sm leading-relaxed mt-2">{review.comment}</p>
          )}
        </div>
      ))}
    </div>
  );
}
