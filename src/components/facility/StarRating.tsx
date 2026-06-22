'use client';

import { useState } from 'react';

interface Props {
  value: number;
  onChange?: (rating: number) => void;
  readonly?: boolean;
  size?: 'sm' | 'md';
}

export default function StarRating({ value, onChange, readonly = false, size = 'md' }: Props) {
  const [hover, setHover] = useState(0);
  const starSize = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6';
  // 操作可能な星は端末タップ最小44pxを常に確保（sm でも視覚サイズは小さいまま、ヒット領域のみ拡張）
  const btnSize = 'min-w-[44px] min-h-[44px]';

  return (
    <div className="flex items-center" role={readonly ? 'img' : undefined} aria-label={readonly ? `${value}点` : undefined}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= (hover || value);
        return (
          <button
            key={star}
            type="button"
            disabled={readonly}
            onClick={() => onChange?.(star)}
            onMouseEnter={() => !readonly && setHover(star)}
            onMouseLeave={() => !readonly && setHover(0)}
            className={`${readonly ? 'cursor-default' : `cursor-pointer hover:scale-110 ${btnSize}`} flex items-center justify-center transition-all`}
            aria-label={readonly ? undefined : `${star}点を選択`}
            aria-hidden={readonly}
            tabIndex={readonly ? -1 : 0}
          >
            <svg className={starSize} viewBox="0 0 24 24" fill={filled ? '#FBBF24' : '#D1D5DB'} xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
