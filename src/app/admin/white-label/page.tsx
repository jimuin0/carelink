'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { verifyAuthUser } from '@/lib/auth-verification';
import FacilitySelector, { loadAdminFacilitySelection, type AdminFacilityChoice } from '@/components/admin/FacilitySelector';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import LoadError from '@/components/admin/LoadError';
import Toast from '@/components/Toast';
import { SbPageHeader } from '@/components/admin/SbUi';

type WhiteLabelDomain = {
  id: string;
  facility_id: string;
  domain: string;
  is_verified: boolean;
  verified_at: string | null;
  txt_record: string | null;
  logo_url: string | null;
  primary_color: string;
  brand_name: string | null;
  created_at: string;
};

function WhiteLabelContent({ requestedFacility }: { requestedFacility: string | null }) {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [choices, setChoices] = useState<AdminFacilityChoice[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [config, setConfig] = useState<WhiteLabelDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    domain: '',
    brand_name: '',
    primary_color: '#0ea5e9',
    logo_url: '',
  });
  const [savedForm, setSavedForm] = useState(JSON.stringify(form));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true); setLoadError(false);
      try {
        const db = createBrowserSupabaseClient();
        const identity = await verifyAuthUser(db.auth);
        if (identity.state !== 'verified') throw new Error('auth_unconfirmed');
        const selection = await loadAdminFacilitySelection(db, identity.user.id, requestedFacility);
        if (cancelled) return;
        setChoices(selection.choices); setFacilityId(selection.selectedId);
        if (!selection.selectedId) return;
        const res = await fetch('/api/admin/white-label?facility_id=' + selection.selectedId);
        if (!res.ok) throw new Error('domain_read_unavailable');
        const data = await res.json();
        if (!data || !('config' in data) || (data.config !== null && data.config.facility_id !== selection.selectedId)) throw new Error('domain_scope_unconfirmed');
        if (cancelled) return;
        setConfig(data.config);
        if (data.config) {
          const values = { domain: data.config.domain || '', brand_name: data.config.brand_name || '',
            primary_color: data.config.primary_color || '#0ea5e9', logo_url: data.config.logo_url || '' };
          setForm(values); setSavedForm(JSON.stringify(values));
        }
      } catch { if (!cancelled) setLoadError(true); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [requestedFacility, reloadKey]);

  const handleSave = async () => {
    if (!form.domain || !facilityId || saving || verifying) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/white-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, facility_id: facilityId }),
      });
      const data = await res.json();
      if (res.ok && data.config?.facility_id === facilityId) {
        setConfig(data.config);
        setSavedForm(JSON.stringify(form));
        setMessage({ ok: true, text: '設定を保存しました。DNSレコードを設定してドメインを認証してください。' });
      } else {
        setMessage({ ok: false, text: data.error || '保存に失敗しました' });
      }
    } catch {
      setMessage({ ok: false, text: '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!config || !facilityId || saving || verifying) return;
    setVerifying(true);
    try {
      const res = await fetch('/api/admin/white-label/verify', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facility_id: facilityId }) });
      if (!res.ok) throw new Error('verification_unavailable');
      const data = await res.json();
      if (data.verified === true) {
        setConfig(prev => prev ? { ...prev, is_verified: true, verified_at: new Date().toISOString() } : null);
        setMessage({ ok: true, text: 'ドメインの所有を確認しました。予約ページの表示は運営による設定後になります。' });
      } else setMessage({ ok: false, text: 'DNS TXTレコードが確認できませんでした。設定を確認してください。' });
    } catch { setMessage({ ok: false, text: 'サーバーエラーが発生しました' }); }
    finally { setVerifying(false); }
  };

  if (loading) return <AdminPageLoading />;
  if (loadError) return <LoadError onRetry={() => setReloadKey(k => k + 1)} message="ドメイン設定の読み込みに失敗しました" />;
  if (!facilityId) return <FacilitySelector choices={choices} selectedId={null} path="/admin/white-label" />;

  return (
    <div className="max-w-3xl space-y-6">
      <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/white-label"
        dirty={JSON.stringify(form) !== savedForm} busy={saving || verifying} />
      <SbPageHeader title="ホワイトラベル設定" description="独自ドメインを登録し、所有を確認します（エンタープライズプラン）。独自ドメインでの予約ページの表示には、運営による設定が必要です。" />

      {message && (
        <Toast
          type={message.ok ? 'success' : 'error'}
          message={message.text}
          onClose={() => setMessage(null)}
        />
      )}

      {/* Plan requirement notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <div className="font-medium text-amber-800">エンタープライズプランが必要</div>
            <p className="text-sm text-amber-700 mt-0.5">ホワイトラベル機能はエンタープライズプランでご利用いただけます。</p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">ドメイン設定</h2>

        <div>
          <label htmlFor="wl-domain" className="block text-xs font-medium text-gray-700 mb-1">独自ドメイン <span className="text-red-500">*</span></label>
          <input
            id="wl-domain"
            type="text"
            value={form.domain}
            onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
            placeholder="booking.yoursite.com"
            maxLength={253}
            disabled={loading}
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">サブドメイン推奨（例：booking.yoursite.com）</p>
        </div>

        <div>
          <label htmlFor="wl-brand" className="block text-xs font-medium text-gray-700 mb-1">ブランド名</label>
          <input
            id="wl-brand"
            type="text"
            value={form.brand_name}
            onChange={(e) => setForm((f) => ({ ...f, brand_name: e.target.value }))}
            placeholder="あなたのサロン名"
            maxLength={100}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="wl-color" className="block text-xs font-medium text-gray-700 mb-1">ブランドカラー</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="ブランドカラー（カラーピッカー）"
                value={form.primary_color}
                onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                className="w-10 h-10 rounded-sm border cursor-pointer"
              />
              <input
                id="wl-color"
                type="text"
                value={form.primary_color}
                onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                maxLength={7}
                className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>
          <div>
            <label htmlFor="wl-logo" className="block text-xs font-medium text-gray-700 mb-1">ロゴURL（任意）</label>
            <input
              id="wl-logo"
              type="url"
              value={form.logo_url}
              onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
              placeholder="https://..."
              maxLength={500}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || verifying || !form.domain}
          className="btn-primary px-4! py-2! text-sm"
        >
          {saving ? '保存中...' : '設定を保存'}
        </button>
      </div>

      {/* DNS verification */}
      {config && !config.is_verified && config.txt_record && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">DNS認証</h2>
          <p className="text-sm text-gray-600">ドメインを認証するために、以下のDNS TXTレコードを追加してください：</p>

          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="grid grid-cols-3 gap-2 text-xs font-medium text-gray-500 uppercase">
              <span>タイプ</span>
              <span>ホスト名</span>
              <span>値</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm font-mono">
              <span>TXT</span>
              <span>_carelink-verify.{config.domain}</span>
              <span className="break-all text-sky-700">{config.txt_record}</span>
            </div>
          </div>

          <p className="text-xs text-gray-500">DNSの反映には最大48時間かかる場合があります</p>

          <button
            type="button"
            onClick={handleVerify}
            disabled={saving || verifying}
            className="bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-600 transition-colors"
          >
            認証を確認する
          </button>
        </div>
      )}

      {/* Verified status
          🔴 DNS 認証で確かめているのは「ドメインの持ち主であること」だけ。独自ドメインで店舗の予約ページを
          出す処理（Host を見て店舗ページへ振り分ける等）は CareLink にまだ無いので、「利用可能です」や
          「開く」リンクを出すと、押した先がエラー（または CareLink のトップ）になる。運営の設定待ちとして伝える。 */}
      {config?.is_verified && (
        <div className="bg-green-50 rounded-xl p-6">
          <div className="flex items-center gap-2 text-green-800">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="font-semibold">ドメイン認証済み（運営による設定待ち）</span>
          </div>
          <p className="text-sm text-green-800 mt-2">
            <strong>{config.domain}</strong> の所有を確認しました。独自ドメインで予約ページを表示するには CareLink 側の設定が必要で、現在は設定待ちです。
          </p>
          <p className="text-sm text-green-800 mt-1">
            設定が済むまでは、このドメインを開いても予約ページは表示されません。お急ぎの場合は CareLink までお問い合わせください。
          </p>
        </div>
      )}

      {/* Vercel domain setup guide */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-gray-900 mb-4">設定手順</h2>
        <ol className="text-sm text-gray-700 space-y-3 list-decimal pl-5">
          <li>上記フォームで独自ドメインを入力して保存</li>
          <li>ドメインのDNS管理画面でCNAMEレコードを追加：<br />
            <code className="bg-gray-100 px-2 py-0.5 rounded-sm text-xs">{form.domain || 'booking.yoursite.com'} → cname.vercel-dns.com</code>
          </li>
          <li>TXTレコードを追加してドメインを認証</li>
          <li>認証が済んだら、独自ドメインで予約ページを表示するための設定を CareLink 運営が行います</li>
          <li>運営の設定が済むまでは、独自ドメインで予約ページは表示されません</li>
        </ol>
      </div>
    </div>
  );
}

function WhiteLabelSelectionRoute() {
  const requested = useSearchParams().get('facility_id');
  return <WhiteLabelContent key={requested ?? 'unselected'} requestedFacility={requested} />;
}
export default function WhiteLabelPage() {
  return <Suspense fallback={<AdminPageLoading />}><WhiteLabelSelectionRoute /></Suspense>;
}
