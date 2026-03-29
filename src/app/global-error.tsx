'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="ja">
      <body>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
              エラーが発生しました
            </h2>
            <p style={{ color: '#6b7280', marginBottom: '2rem' }}>
              申し訳ございません。時間をおいて再度お試しください。
            </p>
            <button
              onClick={reset}
              style={{ padding: '0.5rem 1.5rem', background: '#0284c7', color: 'white', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}
            >
              もう一度試す
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
