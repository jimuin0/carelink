'use client';

import { useState, useEffect } from 'react';

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

  useEffect(() => {
    const check = () => setIsAdded(getCompareList().includes(facilityId));
    check();
    window.addEventListener('compare-updated', check);
    return () => window.removeEventListener('compare-updated', check);
  }, [facilityId]);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const list = getCompareList();
    if (list.includes(facilityId)) {
      setCompareList(list.filter((id) => id !== facilityId));
    } else if (list.length < MAX_COMPARE) {
      setCompareList([...list, facilityId]);
    }
  };

  return (
    <button
      onClick={toggle}
      className={`text-micro px-2 py-1 rounded-full border transition-colors ${
        isAdded ? 'bg-sky-100 border-sky-300 text-sky-700 font-bold' : 'bg-white border-gray-200 text-gray-400 hover:border-sky-300'
      }`}
      title={isAdded ? '比較から外す' : '比較に追加'}
      aria-label={isAdded ? '比較から外す' : '比較に追加'}
    >
      {isAdded ? '比較中' : '比較'}
    </button>
  );
}
