import Spinner from '@/components/Spinner';

// 読み込み中の表示。以前は「旧ダッシュボード形状の灰色スケルトン」で、実際の画面と食い違い
// 「壊れて何も出ていない」ように見えていた。実内容に依存しない明快なスピナー表示に統一する。
export default function AdminLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-gray-400" role="status" aria-live="polite">
      <Spinner className="w-8 h-8 text-sky-500" label="読み込み中" />
      <p className="mt-3 text-sm">読み込み中...</p>
    </div>
  );
}
