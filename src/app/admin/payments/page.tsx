import { SbPageHeader } from '@/components/admin/SbUi';
import { OWNER_ONLINE_PREPAYMENT_NOTICE } from '@/lib/coming-soon';

/**
 * 決済管理（2026年10月23日）。
 *
 * オンライン前払いは「近日公開」（Issue #408・src/lib/coming-soon.ts）で、Stripe 連携も保留中。
 * それなのにこの画面は Stripe アカウントの作成と本番用シークレットキーの取得を求め、
 * 運営へ連絡するよう案内していた（使えない機能のために秘密情報を用意させる）。
 * 近日公開の案内だけを出す。ナビからも外している（src/app/admin/layout.tsx）。
 * 入金設定・決済履歴のデータと API（/api/admin/payments-settings）はそのまま残している。
 * 以前の画面は「所属する最初の店舗」を limit(1) で選んでいたので、戻すときは店舗の選択（FacilitySelector）を通すこと。
 */
export default function AdminPaymentsPage() {
  return (
    <div>
      <SbPageHeader title="決済管理" />
      <div role="status" className="rounded-xl border border-sky-200 bg-white p-5 text-sm text-gray-800 space-y-2">
        <p className="font-bold">{OWNER_ONLINE_PREPAYMENT_NOTICE}</p>
        <p>お支払いは来店時に店舗で受け付けてください。Stripe などの決済サービスのアカウント作成や、秘密鍵の用意は必要ありません。</p>
      </div>
    </div>
  );
}
