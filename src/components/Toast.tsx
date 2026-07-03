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
  onCloseRef.current = onClose;

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

  const bgColor = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
  }[type];

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={`fixed top-20 right-4 z-[100] max-w-sm px-6 py-4 rounded-lg text-white shadow-lg transition-all duration-300 ${bgColor} ${
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">{message}</span>
        <button type="button" onClick={onClose} className="ml-auto p-1 text-white/80 hover:text-white min-w-[32px] min-h-[32px] flex items-center justify-center" aria-label="閉じる">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
