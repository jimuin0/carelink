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

    // 🔴 この2行は effect のトップレベルに置く（async IIFE の中へ入れない）。
    // IIFE の中へ移すと挙動を1ミリも変えずに検出だけが消える＝症状ブロックになるため。
    // 実測（2026年8月16日）: async IIFE 内で await より前の同期 setState は検出されない。
    //
    // setAiAttempted(true) は同一マウント内での二重取得を防ぐガードで、await の後に置くと
    // 取得中に再実行され得る。ここは effect でしか書けない（マウント起点で、対応する
    // イベントハンドラが存在しない）。
    //
    // ⚠️ 2026年8月16日 実機検証で判明: setLoading(true) は【最初のフレームには間に合わない】。
    // useEffect はペイント後に走るため、1フレームだけルールベース要約が見えてから
    // ローディング表示に変わる。StationSearch では同型の欠陥（空状態の誤表示）を実測し
    // イベントハンドラへ移して根治したが、こちらはマウント起点なので同じ手は使えない。
    // ルールベース要約は妥当なフォールバック表示なので実害は小さいと判断しているが、
    // 【この施設ページはこの環境にデータが無く実機確認できていない】。断定はしない。
    // よって直さず、検出を残したまま src/lib/react-compiler-debt.mjs の BASELINE に計上する。
    setAiAttempted(true);
    setLoading(true);

    (async () => {
      try {
        const r = await fetch(`/api/admin/review-summary?facility_id=${facilityId}`);
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (d.summary) setAiSummary(d.summary);
      } catch {
        // フォールバック（ルールベース要約）を使うため無視
      } finally {
        setLoading(false);
      }
    })();
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
