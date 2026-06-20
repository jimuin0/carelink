import AdminPageLoading from '@/components/admin/AdminPageLoading';

// route 遷移・リロード直後の読み込み表示。各クライアントページの fetch 中表示と同一コンポーネントを
// 使い、スピナー位置を全ページで固定する（上→中央のジャンプを無くす）。
export default function AdminLoading() {
  return <AdminPageLoading />;
}
