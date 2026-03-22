'use client';

import { useEffect, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
}

export default function Toast({ message, type, onClose }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
  }[type];

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed top-20 right-4 z-[100] max-w-sm px-6 py-4 rounded-lg text-white shadow-lg transition-all duration-300 ${bgColor} ${
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">{message}</span>
        <button onClick={onClose} className="ml-auto text-white/80 hover:text-white" aria-label="閉じる">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
