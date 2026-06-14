'use client';

import { useEffect, useCallback, useRef, useId } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** 見出し（指定すると aria-labelledby で関連付け） */
  title?: string;
  children: React.ReactNode;
  /** 画面下部に固定表示するアクション領域（モバイルキーボード表示時も到達可能） */
  footer?: React.ReactNode;
  /** パネル最大幅（既定 max-w-lg） */
  maxWidthClass?: string;
}

/**
 * 中央ダイアログ用の共通モーダル。
 *
 * アクセシビリティ（role=dialog / aria-modal / フォーカストラップ / ESC / 背景クリック /
 * 初期フォーカス / フォーカス復帰 / 背景スクロールロック）を一元化し、各ページでの直書きを排除する。
 * 高さは max-h-[90dvh]＋flex-col（body のみスクロール）で、モバイルのソフトキーボード表示時も
 * footer（送信ボタン等）が常に到達可能（dvh はキーボードで縮む）。
 */
export default function Modal({ open, onClose, title, children, footer, maxWidthClass = 'max-w-lg' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
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
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const focusTarget = dialogRef.current?.querySelector<HTMLElement>(
        'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'
      );
      focusTarget?.focus();
    });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        className={`relative bg-white rounded-2xl shadow-xl w-full ${maxWidthClass} max-h-[90dvh] flex flex-col`}
      >
        {title && (
          <div className="px-6 pt-6 pb-3 shrink-0">
            <h2 id={titleId} className="text-lg font-bold">{title}</h2>
          </div>
        )}
        <div className={`px-6 overflow-y-auto grow ${title ? '' : 'pt-6'} ${footer ? '' : 'pb-6'}`}>
          {children}
        </div>
        {footer && (
          <div className="px-6 py-4 border-t border-gray-100 bg-white shrink-0 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
