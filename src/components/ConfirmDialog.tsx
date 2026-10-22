'use client';

import { useEffect, useCallback, useRef, useId } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 確定ボタンを無効化する（処理中の二重発火防止など）。true の間は確定不可。 */
  confirmDisabled?: boolean;
  /** 破壊的操作（キャンセル/削除など取り消せない操作）は 'danger' で確定ボタンを赤くし、誤操作を抑止する。 */
  variant?: 'default' | 'danger';
  /**
   * 開いたあとで内容が変わったことを知らせる一文（例: 確認中に無料キャンセルの期限を過ぎた）。
   * 開いた時点から置いてあるライブリージョンに入れるので、書き換えたときにスクリーンリーダーが読み上げる
   * （本文の書き換えだけでは読み上げられず、押しても何も起きないように聞こえる）。
   */
  notice?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '送信する',
  cancelLabel = 'キャンセル',
  confirmDisabled = false,
  variant = 'default',
  notice = '',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();
  const noticeId = useId();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      // Focus trap
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onCancel]
  );

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      // Focus first button after render
      requestAnimationFrame(() => {
        const firstBtn = dialogRef.current?.querySelector<HTMLElement>('button');
        firstBtn?.focus();
      });
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
        previousFocusRef.current?.focus();
      };
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={notice ? `${messageId} ${noticeId}` : messageId}
    >
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} aria-hidden="true" />
      <div ref={dialogRef} className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        <h3 id={titleId} className="text-lg font-bold mb-2">{title}</h3>
        <p id={messageId} className="text-gray-600 text-sm mb-6">{message}</p>
        {/* 開いた時点から空のまま置いておく（後から文字を入れたときに読み上げられるように）。 */}
        <p
          id={noticeId}
          role="status"
          className={notice ? 'mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900' : 'sr-only'}
        >
          {notice}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="btn-outline flex-1 py-3! px-4! text-sm"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`flex-1 py-3! px-4! text-sm disabled:opacity-50 disabled:cursor-not-allowed ${
              variant === 'danger'
                ? 'font-bold rounded-lg text-white bg-red-600 hover:bg-red-700 transition-colors'
                : 'btn-primary'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
