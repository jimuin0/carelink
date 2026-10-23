import { receiptShortReference } from '@/lib/receipt-reference';

/**
 * 受付番号の表示。36 文字の UUID をそのまま見せると書き写せないため、短い参照（例: 3F2A-9C1E）を
 * 大きく出し、お問い合わせで照会に使う完全な番号を下に添える（運営の検索は完全な番号で行う）。
 */
export default function ReceiptNumber({ id, className = '' }: { id: string; className?: string }) {
  return (
    <div className={`text-sm ${className}`}>
      <p>受付番号：<span className="font-mono text-base font-bold tracking-wider" data-testid="receipt-short">{receiptShortReference(id)}</span></p>
      <p className="mt-1 text-xs">お問い合わせ用の完全な受付番号：<span className="break-all font-mono" data-testid="receipt-full">{id}</span></p>
    </div>
  );
}
