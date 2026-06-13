'use client';

/**
 * データ取得失敗を「空状態」に偽装せず、失敗として明示するための共通表示。
 *
 * Supabase/fetch の error を握り潰して空配列のまま空状態を出すと、管理者が
 * 「データ0件」と誤認し未対応の予約・問い合わせ・登録申請を見落とす（事業リスク）。
 * 取得失敗時は必ず本コンポーネントで「失敗＋再試行」を出し、空状態と区別する。
 */
export default function LoadError({
  onRetry,
  message = 'データの読み込みに失敗しました',
}: {
  onRetry?: () => void;
  message?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-rose-200 p-8 text-center" role="alert">
      <p className="text-rose-600 font-bold mb-1">{message}</p>
      <p className="text-sm text-gray-500 mb-4">通信状況をご確認のうえ、再試行してください。</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center px-4 py-2 text-sm font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 transition-colors"
        >
          再試行
        </button>
      )}
    </div>
  );
}
