'use client';

export default function ContactError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">エラーが発生しました</h2>
        <p className="text-gray-600 mb-8">申し訳ございません。時間をおいて再度お試しください。</p>
        <button onClick={reset} className="btn-primary">もう一度試す</button>
      </div>
    </div>
  );
}
