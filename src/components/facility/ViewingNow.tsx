'use client';

import { useState, useEffect } from 'react';

export default function ViewingNow({ viewCount }: { viewCount: number }) {
  // 「N人が閲覧中」は演出用に軽いランダム要素を持つ。Math.random() を描画中に評価すると
  // サーバ(SSR)とクライアントで値が食い違い hydration mismatch（サーバHTMLとクライアント描画の
  // テキスト不一致→Reactがツリーを再生成）を起こす。マウント後(クライアントのみ)に確定し、初期描画は
  // null にしてサーバHTMLと最初のクライアント描画を一致させる（RemainingSlots と同一の安全パターン）。
  const [viewers, setViewers] = useState<number | null>(null);

  useEffect(() => {
    const randomOffset = Math.floor(Math.random() * 3) + 1;
    setViewers(Math.max(1, Math.floor(viewCount / 100) + randomOffset));
  }, [viewCount]);

  if (viewers === null || viewers <= 0) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-orange-600 font-medium">
      <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
      {viewers}人が閲覧中
    </span>
  );
}
