'use client';

import { useEffect, useRef, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
}

export default function Toast({ message, type, onClose }: ToastProps) {
  const [visible, setVisible] = useState(true);
  const onCloseRef = useRef(onClose);
  // ref への書き込みは render 中ではなく effect 内で行う（React Compiler の
  // refs ルール対策）。deps 無しで毎レンダー後に実行し、常に最新の onClose を保持する
  // という従来の挙動は変えない。
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    // エラーは自動消滅させない。成功/情報と同じ4秒で消すと、管理者が別欄を見ている隙に
    // 「保存に失敗しました」等が消え、失敗に気づかず「保存できた」と誤認する事故になる。
    // エラーはユーザーが×で閉じるまで残す（成功/情報は従来どおり4秒で自動消滅）。
    if (type === 'error') return;
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onCloseRef.current(), 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [type]);

  // 白文字に対して AA（4.5:1）を満たす 700 番台（500 番台は 2.3〜3.8:1 で読みにくかった）。
  const bgColor = {
    success: 'bg-green-700',
    error: 'bg-red-700',
    info: 'bg-blue-700',
  }[type];

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      // スマホ（幅375px）では左右に余白を取って画面内に収める（右寄せ固定だと長い文言が画面外へはみ出した）。
      className={`fixed top-20 left-4 right-4 sm:left-auto sm:right-4 z-100 sm:max-w-sm px-4 sm:px-6 py-4 rounded-lg text-white shadow-lg transition-all duration-300 ${bgColor} ${
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="min-w-0 break-words text-sm font-medium">{message}</span>
        <button type="button" onClick={onClose} className="ml-auto p-1 text-white/80 hover:text-white min-w-[32px] min-h-[32px] flex items-center justify-center" aria-label="閉じる">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
