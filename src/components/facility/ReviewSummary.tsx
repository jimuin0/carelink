'use client';

import { useEffect, useRef, useState } from 'react';
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
  const ruleSummary = generateRuleSummary(reviews);

  // 🔴 「取得中かどうか」はレンダー中に決める（effect で setState しない）。
  //
  // useEffect はコミット後に走るため、effect のトップレベルに setLoading(true) を置いても
  // 【最初のフレームには間に合わない】。旧実装では、AI 要約を取りに行くと決まっているのに
  // 最初のフレームでルールベース要約が見え、次のコミットでスケルトンへ差し替わっていた
  // （＝一度出た文章が消えて戻るちらつき）。2026年8月16日に StationSearch で実測した欠陥と同型。
  //
  // 取りに行く条件（口コミ 3 件以上）はレンダー中に判定できるので、
  // 「今の条件（queryKey）に対する結果を持っているか」で取得中を導出する。
  // これなら発火元が増えても、props が変わっても、最初のフレームから正しくなる。
  // ⚠️ async IIFE の中へ setState を移すのは、挙動を変えずに lint の検出だけ消す症状ブロック。
  const queryKey = reviews.length >= 3 ? `${facilityId}:${reviews.length}` : null;
  const [result, setResult] = useState<{ key: string; summary: string | null } | null>(null);
  // 同一マウント内の二重取得ガード。描画に影響しないので state ではなく ref に置く
  // （state にすると effect からの setState が必要になり、上記の欠陥が復活する）。
  const requestedKeyRef = useRef<string | null>(null);

  const loading = queryKey !== null && result?.key !== queryKey;
  const aiSummary = result?.key === queryKey ? result.summary : null;

  useEffect(() => {
    if (queryKey === null || requestedKeyRef.current === queryKey) return;

    requestedKeyRef.current = queryKey;

    (async () => {
      let summary: string | null = null;
      try {
        const r = await fetch(`/api/admin/review-summary?facility_id=${facilityId}`);
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (d.summary) summary = d.summary;
      } catch {
        // フォールバック（ルールベース要約）を使うため無視
      }
      // 成功・失敗のどちらでも「この条件は取得済み」を記録する。
      // 記録しないと loading が真のままスケルトンが残り続ける。
      setResult({ key: queryKey, summary });
    })();
  }, [facilityId, queryKey]);

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
