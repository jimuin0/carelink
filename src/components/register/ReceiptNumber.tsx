import { receiptShortReference } from '@/lib/receipt-reference';

/**
 * 受付番号の表示。36 文字の UUID をそのまま見せると書き写せないため、短い参照（例: 3F2A-9C1E）を
 * 大きく出し、照会に使う完全な番号は必要なときに開ける（運営の検索は完全な番号で行う）。
 */
export default function ReceiptNumber({ id, className = '' }: { id: string; className?: string }) {
  return (
    <div className={`text-sm ${className}`}>
      <p>受付番号：<span className="font-mono text-base font-bold tracking-wider" data-testid="receipt-short">{receiptShortReference(id)}</span></p>
      <details className="mt-3 text-xs leading-5 text-(--ecru-muted)">
        <summary className="min-h-10 cursor-pointer py-2 text-sm">お問い合わせ用の番号</summary>
        <span className="mt-2 block select-all break-all font-mono text-(--ecru-text)" data-testid="receipt-full">{id}</span>
      </details>
    </div>
  );
}
