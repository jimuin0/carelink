'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 横スクロール領域の端に「まだ続きがある」ことを示すフェードヒントを出す共通部品。
 *
 * スクロール位置を検知して、左にスクロール余地があれば左端に、右に余地があれば右端に
 * グラデーションのフェードを表示する（端まで到達したら消える＝位置に応じた正確なヒント）。
 * CSS のみの常時フェードと違い「もう端まで見た」のに薄く残る誤認を生まない。
 *
 * 背景が白いカード内（管理テーブル等）での利用を想定し from-white の勾配を使う。
 * フェードは pointer-events-none / aria-hidden で操作・読み上げに影響しない。
 */
export default function ScrollHint({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = () => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    // 列の増減・リサイズでスクロール可否が変わるため監視する
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative">
      <div ref={ref} onScroll={update} className={`overflow-x-auto overscroll-x-contain ${className}`.trim()}>
        {children}
      </div>
      {edges.left && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent"
        />
      )}
      {edges.right && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent"
        />
      )}
    </div>
  );
}
