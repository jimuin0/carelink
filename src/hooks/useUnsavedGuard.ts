'use client';

import { useEffect } from 'react';

/**
 * 未保存の編集があるときに、タブを閉じる/リロード/サイト離脱で確認ダイアログを出す。
 *
 * 編集フォームで保存前に誤ってページを離れると入力が失われる事故を防ぐ（発症前予防）。
 * ブラウザ標準の beforeunload 警告を使うため、タブ閉じ/リロード/別サイト遷移/外部リンクを
 * カバーする。アプリ内 SPA 遷移（Next ルータ）は beforeunload が発火しないため対象外
 * （App Router には遷移中断の公式 API が無く、無理に実装すると競合の恐れがあるため）。
 *
 * @param enabled 未保存の変更がある（dirty）間だけ true にする
 */
export function useUnsavedGuard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 一部ブラウザは returnValue 設定で確認ダイアログを表示する
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [enabled]);
}
