'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function CompleteContent() {
  const searchParams = useSearchParams();
  const name = searchParams.get('name') || '';
  const type = searchParams.get('type') || '';
  const area = searchParams.get('area') || '';

  return (
    <div className="section-container">
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold mb-4">登録が完了しました</h1>
        <p className="text-gray-600 mb-8">
          審査後、<strong>3営業日以内</strong>に担当者よりご連絡いたします。
        </p>

        {(name || type || area) && (
          <div className="bg-gray-50 rounded-xl p-6 mb-8 text-left">
            <h2 className="text-sm font-bold text-gray-500 mb-3">登録内容</h2>
            <dl className="space-y-2 text-sm">
              {name && (
                <div className="flex">
                  <dt className="w-20 text-gray-500 flex-shrink-0">施設名</dt>
                  <dd className="font-medium">{name}</dd>
                </div>
              )}
              {type && (
                <div className="flex">
                  <dt className="w-20 text-gray-500 flex-shrink-0">業種</dt>
                  <dd>{type}</dd>
                </div>
              )}
              {area && (
                <div className="flex">
                  <dt className="w-20 text-gray-500 flex-shrink-0">所在地</dt>
                  <dd>{area}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/" className="btn-primary px-8 py-3">
            トップページへ
          </Link>
          <Link href="/search" className="btn-outline px-8 py-3">
            施設を探す
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function RegisterCompletePage() {
  return (
    <Suspense fallback={<div className="section-container text-center py-20">読み込み中...</div>}>
      <CompleteContent />
    </Suspense>
  );
}
