'use client';

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <p className="text-gray-600 mb-4">管理画面の読み込みに失敗しました</p>
      <button onClick={reset} className="btn-primary">
        再読み込み
      </button>
    </div>
  );
}
