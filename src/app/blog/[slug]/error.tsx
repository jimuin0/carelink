'use client';

export default function BlogArticleError({ error: _error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  void _error;
  return (
    <main className="section-container py-16 text-center">
      <h1 className="text-xl font-bold">記事を表示できませんでした</h1>
      <p className="mt-3 text-sm text-gray-600">時間をおいて、もう一度お試しください。</p>
      <button type="button" onClick={() => reset()} className="mt-6 rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white">
        再読み込み
      </button>
    </main>
  );
}
