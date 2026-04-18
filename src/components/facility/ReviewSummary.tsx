'use client';

import { useEffect, useState } from 'react';
import type { FacilityReview } from '@/types';

interface Props {
  reviews: FacilityReview[];
  facilityId: string;
}

/** ルールベース要約（フォールバック用） */
function generateRuleSummary(reviews: FacilityReview[]): string | null {
  if (reviews.length < 3) return null;
  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  const highCount = reviews.filter(r => r.rating >= 4).length;
  const highRate = Math.round((highCount / reviews.length) * 100);
  const ratingText = avg >= 4.5 ? '非常に高い評価' : avg >= 4.0 ? '高い評価' : avg >= 3.5 ? '良い評価' : '評価';
  return `${reviews.length}件の口コミで${ratingText}（${avg.toFixed(1)}）。${highRate}%のお客様が高評価。`;
}

export default function ReviewSummary({ reviews, facilityId }: Props) {
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiAttempted, setAiAttempted] = useState(false);

  const ruleSummary = generateRuleSummary(reviews);

  useEffect(() => {
    if (reviews.length < 3 || aiAttempted) return;
    setAiAttempted(true);
    setLoading(true);
    fetch(`/api/admin/review-summary?facility_id=${facilityId}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { if (d.summary) setAiSummary(d.summary); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [facilityId, reviews.length, aiAttempted]);

  if (!ruleSummary) return null;

  const displaySummary = aiSummary || (!loading ? ruleSummary : null);

  return (
    <div className="bg-sky-50 border border-sky-100 rounded-xl p-4 mb-4">
      <div className="flex items-start gap-2">
        <span className="text-lg shrink-0">✨</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs font-bold text-sky-800">口コミサマリー</p>
            {aiSummary && (
              <span className="text-micro bg-sky-100 text-sky-600 px-1.5 py-0.5 rounded-full font-bold">AI要約</span>
            )}
          </div>
          {loading && !displaySummary ? (
            <div className="space-y-1.5">
              <div className="h-3 bg-sky-100 rounded animate-pulse w-full" />
              <div className="h-3 bg-sky-100 rounded animate-pulse w-4/5" />
            </div>
          ) : (
            <p className="text-sm text-sky-700 leading-relaxed">{displaySummary}</p>
          )}
        </div>
      </div>
    </div>
  );
}
