'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getCompareList, setCompareList } from './CompareButton';

export default function CompareBar() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const update = () => setCount(getCompareList().length);
    update();
    window.addEventListener('compare-updated', update);
    return () => window.removeEventListener('compare-updated', update);
  }, []);

  if (count === 0) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 bg-white shadow-lg rounded-full border border-gray-200 px-4 py-2 flex items-center gap-3">
      <span className="text-sm font-bold text-gray-700">{count}件を比較</span>
      <Link href={`/compare?ids=${getCompareList().join(',')}`} className="text-sm font-bold text-white bg-sky-500 px-4 py-1.5 rounded-full hover:bg-sky-600 transition-colors">
        比較する
      </Link>
      <button
        onClick={() => setCompareList([])}
        className="text-xs text-gray-400 hover:text-red-500 transition-colors"
      >
        クリア
      </button>
    </div>
  );
}
