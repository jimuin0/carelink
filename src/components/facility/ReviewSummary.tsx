import type { FacilityReview } from '@/types';

function generateSummary(reviews: FacilityReview[]): string | null {
  if (reviews.length < 3) return null;

  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  const highCount = reviews.filter(r => r.rating >= 4).length;
  const highRate = Math.round((highCount / reviews.length) * 100);

  // キーワード抽出（頻出単語）
  const words = reviews
    .map(r => r.comment || '')
    .join(' ')
    .split(/[、。！？\s]+/)
    .filter(w => w.length >= 2 && w.length <= 10);

  const wordCounts: Record<string, number> = {};
  for (const w of words) {
    // ストップワード除外
    if (['です', 'ます', 'した', 'ました', 'ありがとう', 'ございました', 'とても', 'すごく', 'また'].includes(w)) continue;
    wordCounts[w] = (wordCounts[w] || 0) + 1;
  }

  const topWords = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);

  const ratingText = avg >= 4.5 ? '非常に高い評価' : avg >= 4.0 ? '高い評価' : avg >= 3.5 ? '良い評価' : '評価';

  const keywordText = topWords.length > 0 ? `「${topWords.join('」「')}」` : '';

  return `${reviews.length}件の口コミで${ratingText}（${avg.toFixed(1)}）。${highRate}%のお客様が高評価。${keywordText ? `${keywordText}に関する声が多く寄せられています。` : ''}`;
}

export default function ReviewSummary({ reviews }: { reviews: FacilityReview[] }) {
  const summary = generateSummary(reviews);
  if (!summary) return null;

  return (
    <div className="bg-sky-50 rounded-xl p-4 mb-4">
      <div className="flex items-start gap-2">
        <span className="text-lg">✨</span>
        <div>
          <p className="text-xs font-bold text-sky-800 mb-1">口コミサマリー</p>
          <p className="text-sm text-sky-700">{summary}</p>
        </div>
      </div>
    </div>
  );
}
