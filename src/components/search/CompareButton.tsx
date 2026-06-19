'use client';

import { useState, useEffect, useRef } from 'react';

const STORAGE_KEY = 'compare_facilities';
const MAX_COMPARE = 3;

export function getCompareList(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

export function setCompareList(ids: string[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_COMPARE)));
  window.dispatchEvent(new Event('compare-updated'));
}

export default function CompareButton({ facilityId }: { facilityId: string }) {
  const [isAdded, setIsAdded] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [showLimit, setShowLimit] = useState(false);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const check = () => {
      const list = getCompareList();
      setIsAdded(list.includes(facilityId));
      setIsFull(list.length >= MAX_COMPARE);
    };
    check();
    window.addEventListener('compare-updated', check);
    return () => window.removeEventListener('compare-updated', check);
  }, [facilityId]);

  // 上限メッセージのタイマーをアンマウント時にクリア（unmount後 setState 警告の回避）。
  useEffect(() => () => { if (limitTimer.current) clearTimeout(limitTimer.current); }, []);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const list = getCompareList();
    if (list.includes(facilityId)) {
      setCompareList(list.filter((id) => id !== facilityId));
    } else if (list.length < MAX_COMPARE) {
      setCompareList([...list, facilityId]);
    } else {
      // 満杯(3件)時に無反応(デッドタップ)になるのを防ぐ。上限を明示する。
      setShowLimit(true);
      if (limitTimer.current) clearTimeout(limitTimer.current);
      limitTimer.current = setTimeout(() => setShowLimit(false), 2000);
    }
  };

  // 満杯かつ未追加＝これ以上追加できない状態（追加不可を視覚化）。
  const blocked = isFull && !isAdded;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        aria-disabled={blocked}
        className={`text-micro px-2 py-1 rounded-full border transition-colors ${
          isAdded
            ? 'bg-sky-100 border-sky-300 text-sky-700 font-bold'
            : blocked
              ? 'bg-white border-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-white border-gray-200 text-gray-600 hover:border-sky-300'
        }`}
        title={isAdded ? '比較から外す' : blocked ? '比較は最大3件までです' : '比較に追加'}
        aria-label={isAdded ? '比較から外す' : blocked ? '比較は最大3件までです（追加できません）' : '比較に追加'}
      >
        {isAdded ? '比較中' : '比較'}
      </button>
      {showLimit && (
        <span
          role="status"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1 whitespace-nowrap rounded bg-gray-800 text-white text-micro px-2 py-1 z-10 shadow"
        >
          最大3件まで比較できます
        </span>
      )}
    </span>
  );
}
