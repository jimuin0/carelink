import Spinner from '@/components/Spinner';

// 管理画面の「読み込み中」表示（全ページ・全状況で同一の見た目・同一位置）。
// route の loading.tsx（リロード直後）と、各クライアントページの client-side fetch 中表示の
// 両方でこれを使うことで、スピナーの位置が上→中央へジャンプする違和感を無くす。
export default function AdminPageLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-gray-400" role="status" aria-live="polite">
      <Spinner className="w-8 h-8 text-sky-500" label="読み込み中" />
      <p className="mt-3 text-sm">読み込み中...</p>
    </div>
  );
}
