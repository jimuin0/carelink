import { forwardRef, type SelectHTMLAttributes } from 'react';

/**
 * 共通セレクト（デザイン統一フェーズ1・2026年10月23日）。
 *
 * why: ブラウザ既定の <select> は OS ごとに高さ・矢印が違い、iOS Safari では角丸・グラデーションの
 *   独自描画になって他の入力欄と揃わない。さらに 16px 未満の文字の入力欄にフォーカスすると
 *   iOS は画面を勝手に拡大する。ここで appearance を外し、高さ・角丸・矢印を自前で揃える。
 *
 * - 高さ: md=44px（既定・タップ領域の推奨値）/ sm=36px。角丸は `rounded-control`（Button と同じ 12px）。
 * - 文字: 16px（text-base）。iOS のフォーカス時ズームを起こさない最小値。
 * - 矢印: gray-500 #6B7280（白地で 4.83:1。非テキストの 3:1 を満たす）。クリックを素通しする（pointer-events-none）。
 * - 本文 gray-900 / 白 17.74:1。無効時 gray-600 #4B5563 / gray-100 #F3F4F6 で 6.87:1。
 * - フォーカス枠は --primary（Button と同じ）。aria-invalid の時は枠を red-700 にする（form-input と同じ）。
 *
 * ref は <select> に渡る（react-hook-form の register にそのまま使える）。
 * `className` は <select> 自身に、`wrapperClassName` は外側の箱（幅・余白）に付く。
 * 高さは h-full＋min-h なので、グリッドの行で隣の入力欄が高ければそれに揃って伸びる。
 */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  wrapperClassName?: string;
  size?: 'sm' | 'md';
}

const SIZES = { sm: 'min-h-9', md: 'min-h-11' } as const;

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, wrapperClassName, size = 'md', children, ...rest },
  ref,
) {
  return (
    <div className={['relative', wrapperClassName ?? ''].filter(Boolean).join(' ')}>
      <select
        ref={ref}
        className={[
          'block h-full w-full appearance-none rounded-control border border-gray-300 bg-white py-1.5 pl-3 pr-10',
          'text-base text-gray-900 transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary)',
          'aria-invalid:border-red-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600',
          SIZES[size],
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        data-select-chevron=""
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
});

export default Select;
