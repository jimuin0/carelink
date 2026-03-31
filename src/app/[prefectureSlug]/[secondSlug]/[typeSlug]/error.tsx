'use client';

export default function TypeError({ error, reset }: { error: Error; reset: () => void }) {
  void error;
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-500 mb-4">ページの読み込みに失敗しました</p>
        <button onClick={() => reset()} className="text-sm text-sky-600 hover:underline">
          再読み込み
        </button>
      </div>
    </div>
  );
}
