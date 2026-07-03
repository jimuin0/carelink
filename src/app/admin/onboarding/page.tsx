'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { Suspense } from 'react';

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'creating' | 'error'>('loading');
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
        // 既に施設あり → 管理ダッシュボードへ。ダッシュボードは登録状況をライブに反映する
        // 正確なオンボーディング進捗（メニュー/スタッフ/写真/スケジュール/公開）を表示する。
        // 旧実装はここで静的チェックリストを描画し、公開条件の案内もスタッフ必須が抜けて誤っていた。
        router.replace('/admin');
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
        // 施設作成成功 → 動的な進捗を持つ管理ダッシュボードへ。
        router.replace('/admin');
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

  // done 状態は廃止（施設確定後は /admin へ replace 済み）。到達時はリダイレクト待ちの空表示。
  return null;
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center"><div className="w-12 h-12 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" /></div>}>
      <OnboardingContent />
    </Suspense>
  );
}
