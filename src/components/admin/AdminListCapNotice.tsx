import { ADMIN_LIST_LIMIT } from '@/lib/admin-list-cap';

/** 一覧を上限で打ち切ったときだけ出す注記（capAdminList の truncated を渡す）。 */
export default function AdminListCapNotice({ truncated }: { truncated: boolean }) {
  if (!truncated) return null;
  return (
    <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      最新の{ADMIN_LIST_LIMIT}件だけを表示しています。それより古いものはこの一覧には出ていません。
    </p>
  );
}
