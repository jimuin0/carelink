import { formatReviewAverage, type ReviewRatingSummary } from '@/lib/review-rating-summary';

/**
 * 口コミ評価カード（ホットペッパービューティー型＝総合＋項目別・2026年10月22日）。
 * 集計は src/lib/review-rating-summary.ts。旧「NPS スコア」カードの置き換え。
 */
export default function ReviewRatingCard({ summary }: { summary: ReviewRatingSummary }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h2 className="font-bold text-sm mb-3">口コミ評価</h2>
      {summary.count === 0 ? (
        <p className="text-sm text-gray-500">まだ口コミがありません</p>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-gray-600">総合</span>
            <span className="text-amber-500 text-xl" aria-hidden="true">★</span>
            <span className="text-3xl font-bold text-gray-900">{formatReviewAverage(summary.overall)}</span>
            <span className="text-xs text-gray-600">（{summary.count}件）</span>
          </p>
          <dl className="mt-3 space-y-1.5">
            {summary.items.map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-sm">
                <dt className="w-[5.5em] shrink-0 text-gray-600">{item.label}</dt>
                <dd className="flex flex-1 items-center gap-2">
                  <span className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden" aria-hidden="true">
                    <span
                      className="block h-full bg-amber-400 rounded-full"
                      style={{ width: `${((item.average ?? 0) / 5) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 text-right font-medium text-gray-800">{formatReviewAverage(item.average)}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-gray-500">公開中の口コミ（全期間）の平均です。</p>
        </>
      )}
    </div>
  );
}
