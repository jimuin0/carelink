'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'already' | 'error'>('loading');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    const run = async () => {
      try {
        const res = await fetch('/api/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          const body = await res.json();
          setStatus(body.already ? 'already' : 'success');
        } else {
          setStatus('error');
        }
      } catch {
        setStatus('error');
      }
    };
    run();
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-4">
          {status === 'loading' && '⏳'}
          {status === 'success' && '✅'}
          {status === 'already' && 'ℹ️'}
          {status === 'error' && '❌'}
        </div>
        <h1 className="text-xl font-bold mb-2">
          {status === 'loading' && '処理中...'}
          {status === 'success' && '配信停止しました'}
          {status === 'already' && '既に配信停止済みです'}
          {status === 'error' && 'エラーが発生しました'}
        </h1>
        <p className="text-gray-500 text-sm">
          {status === 'loading' && 'しばらくお待ちください...'}
          {status === 'success' && 'CareLink からのメール配信を停止しました。再び受信するにはマイページから設定を変更してください。'}
          {status === 'already' && '既にメール配信停止済みです。再度受信するにはマイページから設定を変更してください。'}
          {status === 'error' && 'リンクが無効か期限切れです。マイページから設定を変更してください。'}
        </p>
        <a
          href="/"
          className="mt-6 inline-block text-sky-500 hover:underline text-sm"
        >
          トップページへ
        </a>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense>
      <UnsubscribeContent />
    </Suspense>
  );
}
