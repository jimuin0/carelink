'use client';

import { useRef } from 'react';

export default function ViewingNow({ viewCount }: { viewCount: number }) {
  const randomOffset = useRef(Math.floor(Math.random() * 3) + 1);
  const viewers = Math.max(1, Math.floor(viewCount / 100) + randomOffset.current);

  if (viewers <= 0) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-orange-600 font-medium">
      <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
      {viewers}人が閲覧中
    </span>
  );
}
