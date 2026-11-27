'use client';

import { useEffect } from 'react';
import { lockBodyScroll } from '@/lib/body-scroll-lock';

/**
 * active の間だけ、ページ本体（body）のスクロールを止める。
 * スマホのメニューを開いているときに、メニューをスクロールすると後ろのページまで動く不具合の対策
 * （2026年11月27日 神原さん報告）。Modal 等と重なっても壊れないよう、数え方は lib/body-scroll-lock.ts に任せる。
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return lockBodyScroll();
  }, [active]);
}

/**
 * スマホのメニューを自動で閉じる（Codex 指摘 ML-02・2026年11月27日 神原さん報告）。
 * - ページが変わったら閉じる（同じヘッダーのまま別のページへ移ると、開いたまま後ろが止まり続けていた）
 * - 画面幅が広がってメニュー自体が隠れたら閉じる（隠れたのに後ろが止まったままになっていた）
 * リンクを押したときに閉じるのは、各ヘッダーの onClickCapture（closeOnLinkClick）で行う。
 */
// hiddenFrom は Tailwind の sm/md と同じ rem で渡す（px にすると既定の文字サイズを大きくした人で境目がずれる・Codex 指摘 ML-02）
export function useMobileMenuAutoClose(open: boolean, close: () => void, hiddenFrom: '40rem' | '48rem', pathname: string | null): void {
  useEffect(() => {
    close();
    // pathname が変わったときだけ閉じる（close は毎回作り直されても気にしない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(min-width: ${hiddenFrom})`);
    const onChange = () => { if (query.matches) close(); };
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [open, close, hiddenFrom]);
}

/** ヘッダーの中のリンクを押したら、移動先が同じページでもメニューを閉じる（メニューに隠れて画面が変わらないように見えた）。 */
export function closeOnLinkClick(close: () => void) {
  return (event: { target: EventTarget | null }) => {
    if (event.target instanceof Element && event.target.closest('a')) close();
  };
}
