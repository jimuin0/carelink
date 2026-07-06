import Spinner from '@/components/Spinner';

// 全ページ共通の「読み込み中」表示。route の loading.tsx（画面遷移・リロード直後）と、
// 各クライアントページの client-side fetch 中表示の両方でこれを使うことで、
// ページごとに異なるスケルトン形状が出て「読み込み中」と伝わりにくかった問題を解消する
// （2026年7月6日・神原さん指摘）。
export default function PageLoading() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-gray-400" role="status" aria-live="polite">
      <Spinner className="w-10 h-10 text-sky-500" label="読み込み中" />
      <p className="mt-4 text-sm">読み込み中...</p>
    </div>
  );
}
