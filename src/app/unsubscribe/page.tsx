'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const n = searchParams.get('n');
  const email = searchParams.get('email');
  const hmac = searchParams.get('hmac');
  // 旧実装は mount 時の useEffect で即 POST していたが、Outlook Safe Links 等のメールスキャナや
  // ブラウザのリンクプリフェッチが URL を先読みするだけで本人の意図なく配信停止されてしまう
  // （ワンクリック確認の欠如）。明示ボタンのクリックで初めて POST する方式に変更する。
  const [status, setStatus] = useState<'confirm' | 'loading' | 'success' | 'already' | 'error'>('confirm');

  const payload = token
    ? { token }
    : n
      ? { n }
      : email && hmac
        ? { email, hmac }
        : null;

  // リンク自体が不正（必要なパラメータが無い）な場合のみ、クリックを待たず error 表示にする。
  useEffect(() => {
    if (!payload) setStatus('error');
    // payload は searchParams から同期的に導出される（依存は個別の文字列）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, n, email, hmac]);

  const handleUnsubscribe = async () => {
    if (!payload) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-4">
          {status === 'confirm' && '📧'}
          {status === 'loading' && '⏳'}
          {status === 'success' && '✅'}
          {status === 'already' && 'ℹ️'}
          {status === 'error' && '❌'}
        </div>
        <h1 className="text-xl font-bold mb-2">
          {status === 'confirm' && 'メール配信を停止しますか？'}
          {status === 'loading' && '処理中...'}
          {status === 'success' && '配信停止しました'}
          {status === 'already' && '既に配信停止済みです'}
          {status === 'error' && 'エラーが発生しました'}
        </h1>
        <p className="text-gray-500 text-sm">
          {status === 'confirm' && '下のボタンを押すと CareLink からのメール配信を停止します。'}
          {status === 'loading' && 'しばらくお待ちください...'}
          {status === 'success' && 'CareLink からのメール配信を停止しました。再び受信するにはマイページから設定を変更してください。'}
          {status === 'already' && '既にメール配信停止済みです。再度受信するにはマイページから設定を変更してください。'}
          {status === 'error' && 'リンクが無効か期限切れです。マイページから設定を変更してください。'}
        </p>
        {status === 'confirm' && (
          <button
            type="button"
            onClick={handleUnsubscribe}
            className="mt-6 inline-block bg-sky-600 hover:bg-sky-700 text-white font-bold px-6 py-2.5 rounded-lg text-sm"
          >
            配信を停止する
          </button>
        )}
        <Link
          href="/"
          className="mt-6 block text-sky-500 hover:underline text-sm"
        >
          トップページへ
        </Link>
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
