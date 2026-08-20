'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { Suspense } from 'react';
import { SbInput, SbPageHeader } from '@/components/admin/SbUi';
import { businessTypes } from '@/lib/constants';

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 'form' = 施設名・業態の入力（確認）待ち。既存施設が無い認証済みユーザーは
  // クエリの有無に関わらず必ずここを経由する（下記 useEffect の 2026年8月20日コメント参照。
  // 誰でも到達できる /admin/onboarding で確認なしに施設を自動作成していた欠陥の根治）。
  const [status, setStatus] = useState<'loading' | 'form' | 'creating' | 'error'>('loading');
  const [error, setError] = useState('');
  const [facilityNameInput, setFacilityNameInput] = useState('');
  const [businessTypeInput, setBusinessTypeInput] = useState('');
  const [formError, setFormError] = useState('');
  // 【2026年7月29日】許認可・届出の表明保証（利用規約 第12条）。
  // /register を経由せず直接ここへ到達して施設を作れるため、/register と同じ表明をここでも取る
  // （片方だけに置くと、表明のない施設が作れる抜け道が残る）。
  const [licenseWarranted, setLicenseWarranted] = useState(false);

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

      const facilityName = searchParams.get('facility_name') || '';
      const businessType = searchParams.get('business_type') || '';

      // 【2026年8月20日・恒久根治】クエリだけで無確認に POST /api/facility/setup を
      // 撃つ経路を廃止した。旧実装は facility_name があり business_type が正規値なら
      // ユーザー操作を1回も挟まずに施設を作っていたため、
      // `https://carelink-jp.com/admin/onboarding?facility_name=任意&business_type=<正規値>`
      // を「ログイン済みで施設未所持」の一般利用者に踏ませるだけで、その人の権限で
      // facility_profiles が作られ facility_members に owner として登録されてしまう
      // （CSRF は Origin 一致のみなので自サイト内リンクは通過し、middleware も
      // /admin/onboarding をメンバーシップ判定から除外しているため止まらない）。
      // オーナーが自分の施設を削除する手段は無く、踏んだ人は身に覚えのない施設の
      // オーナーのまま1施設ガードで二度と自分の店を登録できなくなる。
      // さらに自動POST経路は handleFormSubmit が必須にしている licenseWarranted
      // （許認可・届出の表明・利用規約第12条）を一度も見せずに施設を作っていた。
      // クエリ値は入力の手間を減らすためフォームの初期値としてのみ使い、
      // 必ずユーザーが送信ボタンを押した場合だけ POST する（1クリック増える代わりに
      // 第三者リンクでの焼き討ちが消え、許認可表明が全経路で必ず取られる）。
      setFacilityNameInput(facilityName);
      if (businessType && businessTypes.includes(businessType)) {
        setBusinessTypeInput(businessType);
      }
      setStatus('form');
    };

    setup();
  }, [router, searchParams]);

  const handleFormSubmit = async () => {
    const trimmedName = facilityNameInput.trim();
    if (!trimmedName) {
      setFormError('施設名を入力してください');
      return;
    }
    if (!businessTypeInput) {
      setFormError('業態を選択してください');
      return;
    }
    if (!licenseWarranted) {
      setFormError('許認可・届出に関する表明にチェックしてください');
      return;
    }
    setFormError('');
    setStatus('creating');

    const res = await fetch('/api/facility/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facility_name: trimmedName,
        business_type: businessTypeInput,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (data.success) {
      router.replace('/admin');
    } else {
      setError(data.error || '施設の作成に失敗しました');
      setStatus('error');
    }
  };

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

  if (status === 'form') {
    return (
      <div className="section-container max-w-lg mx-auto py-16">
        <SbPageHeader title="施設情報を入力" description="予約管理を始めるには、まず施設の基本情報を登録してください" />
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div>
            <label htmlFor="onboarding-facility-name" className="form-label">
              施設名 <span className="text-red-500">*</span>
            </label>
            <SbInput
              id="onboarding-facility-name"
              value={facilityNameInput}
              onChange={(e) => setFacilityNameInput(e.target.value)}
              maxLength={100}
            />
          </div>
          <div>
            <label htmlFor="onboarding-business-type" className="form-label">
              業態 <span className="text-red-500">*</span>
            </label>
            <select
              id="onboarding-business-type"
              value={businessTypeInput}
              onChange={(e) => setBusinessTypeInput(e.target.value)}
              className="form-input"
              aria-required="true"
            >
              <option value="">選択してください</option>
              {businessTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={licenseWarranted}
              onChange={(e) => setLicenseWarranted(e.target.checked)}
              className="mt-0.5 rounded border-gray-300"
            />
            <span>
              当施設の運営に法令上必要な許可・免許・届出（美容所開設届、施術所開設届、診療所開設届等）を
              すべて完了しており、施術は必要な資格を有する者が提供することを表明します（必須）
            </span>
          </label>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <button type="button" onClick={handleFormSubmit} className="btn-primary w-full !py-3">
            施設を作成する
          </button>
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
