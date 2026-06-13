'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Link from 'next/link';
import { Suspense } from 'react';

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'creating' | 'done' | 'error'>('loading');
  const [, setFacilityId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const setup = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/auth/login?redirect=/admin/onboarding');
        return;
      }

      // 既にfacility_membersに登録済みか確認
      const { data: existing, error: existErr } = await supabase
        .from('facility_members')
        .select('facility_id')
        .eq('user_id', user.id)
        .maybeSingle();

      // 取得失敗を「未登録」と誤認すると既存ユーザーで重複セットアップを試みうるため、失敗として明示する
      if (existErr) {
        setError('施設情報の確認に失敗しました。通信環境を確認して再読み込みしてください');
        setStatus('error');
        return;
      }

      if (existing) {
        setFacilityId(existing.facility_id);
        setStatus('done');
        return;
      }

      // 施設セットアップAPI呼び出し
      setStatus('creating');

      const facilityName = searchParams.get('facility_name') || '';
      const businessType = searchParams.get('business_type') || '';

      const res = await fetch('/api/facility/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facility_name: facilityName || '未設定の施設',
          business_type: businessType || '美容サロン・アイラッシュ',
        }),
      });

      const data = await res.json();
      if (data.success) {
        setFacilityId(data.facilityId);
        setStatus('done');
      } else {
        setError(data.error || '施設の作成に失敗しました');
        setStatus('error');
      }
    };

    setup();
  }, [router, searchParams]);

  if (status === 'loading' || status === 'creating') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-600">
            {status === 'loading' ? '確認中...' : '施設を作成しています...'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="section-container max-w-lg mx-auto text-center py-16">
        <p role="alert" className="text-red-600 font-bold mb-4">エラーが発生しました</p>
        <p className="text-sm text-gray-600 mb-6">{error}</p>
        <button type="button" onClick={() => window.location.reload()} className="btn-primary px-8 py-3">再試行</button>
      </div>
    );
  }

  return (
    <div className="section-container">
      <div className="max-w-2xl mx-auto py-8">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">施設の準備ができました！</h1>
          <p className="text-sm text-gray-500">以下の項目を登録すると、検索サイトに掲載されます。</p>
        </div>

        <div className="space-y-4">
          {[
            { href: '/admin/menus', label: 'メニューを登録', desc: '施術メニュー・料金・施術時間', icon: '📋', priority: true },
            { href: '/admin/staff', label: 'スタッフを登録', desc: '担当者の名前・役職・経歴', icon: '👤', priority: true },
            { href: '/admin/photos', label: '写真をアップロード', desc: '外観・内観・メニュー写真', icon: '📷', priority: true },
            { href: '/admin/settings', label: '施設情報を編集', desc: '営業時間・住所・特徴タグ', icon: '⚙️', priority: false },
            { href: '/admin/coupons/new', label: 'クーポンを作成', desc: '新規限定・リピーター向け', icon: '🎫', priority: false },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-4 p-5 rounded-xl border transition-all hover:shadow-md ${
                item.priority ? 'bg-white border-sky-200 hover:border-sky-400' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <span className="text-2xl">{item.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-800">{item.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
              </div>
              <span className="text-gray-400">&rsaquo;</span>
            </Link>
          ))}
        </div>

        <div className="mt-10 p-5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-sm font-bold text-amber-800 mb-1">公開について</p>
          <p className="text-xs text-amber-700">
            メニューと写真を最低1つずつ登録すると、施設設定ページから「公開」できます。
            公開すると検索結果に表示され、お客様からの予約を受け付けられます。
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link href="/admin" className="text-sm text-sky-600 hover:underline">
            管理ダッシュボードへ →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center"><div className="w-12 h-12 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" /></div>}>
      <OnboardingContent />
    </Suspense>
  );
}
