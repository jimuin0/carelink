import Link from 'next/link';
import type { ReactNode } from 'react';

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

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border border-amber-300',
  confirmed: 'bg-pink-100 text-pink-800 border border-pink-300',
  completed: 'bg-gray-100 text-gray-700 border border-gray-300',
  cancelled: 'bg-red-100 text-red-800 border border-red-300',
  cancel_fee_paid: 'bg-orange-100 text-orange-800 border border-orange-300',
  no_show: 'bg-red-100 text-red-800 border border-red-300',
};
const STATUS_LABEL: Record<string, string> = {
  pending: '確認待ち', confirmed: '確定', completed: '完了',
  cancelled: 'キャンセル', cancel_fee_paid: 'ｷｬﾝｾﾙ料済', no_show: '無断',
};

/** 予約ステータスのチップ（色・ラベルを全画面で統一） */
export function SbStatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-600 border border-gray-300'}`}>
      {STATUS_LABEL[status] ?? status}
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

export { STATUS_LABEL, STATUS_STYLE };
