import Link from 'next/link';
import { forwardRef, type ReactNode, type InputHTMLAttributes } from 'react';
import { bookingStatusLabel, statusChipClass } from '@/lib/booking-status';
import ScrollHint from './ScrollHint';

/**
 * テキスト入力の共通部品。globals.css の .form-input スタイルを単一ソースとして適用し、
 * 各管理ページで直書きされていた input のクラスを統一する。
 * すべての input 属性（type/value/onChange/min/max/required/disabled/name/id 等）を
 * そのまま透過する。checkbox/radio/file など非テキスト系はスタイル要件が異なるため対象外。
 */
export const SbInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function SbInput({ className = '', ...props }, ref) {
    return <input ref={ref} className={`form-input ${className}`.trim()} {...props} />;
  }
);

/**
 * SB 共通 UI 部品（HotPepper サロンボード型・CareLink 色）
 * 各管理ページで再利用し、見た目と操作性を統一する。サーバーコンポーネントから使える純粋表示部品。
 */

/** ページ見出しバー（タイトル＋説明＋右側アクション） */
export function SbPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4 border-b border-gray-200 pb-3">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold text-gray-800 leading-tight">{title}</h1>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** KPI 数値カード（HPB のサマリー数値タイル） */
export function SbStatCard({
  label,
  value,
  unit,
  href,
  accent = 'sky',
}: {
  label: string;
  value: number | string;
  unit?: string;
  href?: string;
  accent?: 'sky' | 'amber' | 'emerald' | 'rose' | 'gray';
}) {
  const accentMap: Record<string, string> = {
    sky: 'border-t-sky-500',
    amber: 'border-t-amber-500',
    emerald: 'border-t-emerald-500',
    rose: 'border-t-rose-500',
    gray: 'border-t-gray-400',
  };
  const inner = (
    <div className={`bg-white rounded-lg border border-gray-200 border-t-[3px] ${accentMap[accent]} p-4 h-full ${href ? 'hover:shadow-md transition-shadow' : ''}`}>
      <p className="text-xs font-bold text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-gray-800">
        {value}
        {unit && <span className="text-sm font-bold text-gray-400 ml-1">{unit}</span>}
      </p>
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

/** 白カード（セクションの器）。title 任意・右上 action 任意 */
export function SbCard({
  title,
  action,
  children,
  className = '',
  padded = true,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      {(title || action) && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
          {title && <h2 className="text-sm font-bold text-gray-700">{title}</h2>}
          {action && <div className="ml-auto">{action}</div>}
        </div>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

/** 予約ステータスのチップ（色・ラベルは @/lib/booking-status に集約・全画面で統一） */
export function SbStatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${statusChipClass(status)}`}>
      {bookingStatusLabel(status)}
    </span>
  );
}

/**
 * 一覧テーブルの共通枠。横スクロール器＋統一スタイルを一元化する。
 * thead は <SbThead>、見出しセルは <SbTh>、本体は <SbTbody>、データセルは <SbTd> を使う。
 * これにより各管理ページで直書きされていた <table>/<th>/<td> のスタイルを単一ソースに統一する。
 */
export function SbTable({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <ScrollHint>
      <table className={`w-full text-sm ${className}`}>{children}</table>
    </ScrollHint>
  );
}

/** テーブル見出し行（<SbTh> を children に並べる） */
export function SbThead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-gray-50 border-b border-gray-200">
      <tr>{children}</tr>
    </thead>
  );
}

type SbAlign = 'left' | 'center' | 'right';
const sbAlignClass: Record<SbAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

/** 見出しセル（align で左右中央、className で hidden 等の追加クラス可） */
export function SbTh({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode;
  align?: SbAlign;
  className?: string;
}) {
  return (
    <th className={`px-4 py-2.5 font-medium text-xs text-gray-500 whitespace-nowrap ${sbAlignClass[align]} ${className}`}>
      {children}
    </th>
  );
}

/** データ本体（行間の境界線を統一） */
export function SbTbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-gray-100">{children}</tbody>;
}

/** データセル（align で左右中央、className で hidden 等の追加クラス可） */
export function SbTd({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode;
  align?: SbAlign;
  className?: string;
}) {
  return <td className={`px-4 py-3 ${sbAlignClass[align]} ${className}`}>{children}</td>;
}

/**
 * 状態バッジ（ステータスピル）の共通部品。
 * 各ページで直書きされていた `bg-*-100 text-*-700 rounded-full` のピルを単一ソースに統一する。
 * 色は意味（tone）で指定する。状態文字列→tone のマッピングは呼び出し側が決める
 * （予約ステータスは別途 @/lib/booking-status の SbStatusChip を使う）。
 */
export type SbBadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const sbBadgeToneClass: Record<SbBadgeTone, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-700',
  info: 'bg-sky-100 text-sky-700',
  neutral: 'bg-gray-100 text-gray-600',
};

export function SbBadge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: SbBadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${sbBadgeToneClass[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** ボタン風リンク（primary / outline） */
export function SbButtonLink({
  href,
  children,
  variant = 'primary',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'outline';
}) {
  const cls = variant === 'primary'
    ? 'bg-sky-600 hover:bg-sky-700 text-white'
    : 'bg-white border border-sky-300 text-sky-700 hover:bg-sky-50';
  return (
    <Link href={href} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${cls}`}>
      {children}
    </Link>
  );
}
