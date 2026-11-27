'use client';

import { useEffect } from 'react';

/**
 * active の間だけ、ページ本体（body）のスクロールを止める。
 * スマホのメニューを開いているときに、メニューをスクロールすると後ろのページまで動く不具合の対策
 * （2026年11月27日 神原さん報告）。閉じたら、開く前の値に戻す（Modal などが先に止めていても壊さない）。
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previous;
    };
  }, [active]);
}
