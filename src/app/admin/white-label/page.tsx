'use client';

import { useState, useEffect } from 'react';

type WhiteLabelDomain = {
  id: string;
  domain: string;
  is_verified: boolean;
  verified_at: string | null;
  txt_record: string | null;
  logo_url: string | null;
  primary_color: string;
  brand_name: string | null;
  created_at: string;
};

export default function WhiteLabelPage() {
  const [config, setConfig] = useState<WhiteLabelDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    domain: '',
    brand_name: '',
    primary_color: '#0ea5e9',
    logo_url: '',
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/admin/white-label')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => {
        if (d.config) {
          setConfig(d.config);
          setForm({
            domain: d.config.domain || '',
            brand_name: d.config.brand_name || '',
            primary_color: d.config.primary_color || '#0ea5e9',
            logo_url: d.config.logo_url || '',
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!form.domain) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/white-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setConfig(data.config);
        setMessage({ ok: true, text: '設定を保存しました。DNSレコードを設定してドメインを認証してください。' });
      } else {
        setMessage({ ok: false, text: data.error || '保存に失敗しました' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!config) return;
    const res = await fetch(`/api/admin/white-label/verify`, { method: 'POST' });
    if (!res.ok) { setMessage({ ok: false, text: 'サーバーエラーが発生しました' }); return; }
    const data = await res.json();
    if (data.verified) {
      setConfig((prev) => prev ? { ...prev, is_verified: true, verified_at: new Date().toISOString() } : null);
      setMessage({ ok: true, text: 'ドメインを認証しました！' });
    } else {
      setMessage({ ok: false, text: 'DNS TXTレコードが確認できませんでした。設定を確認してください。' });
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ホワイトラベル設定</h1>
        <p className="text-sm text-gray-500 mt-1">施設独自のドメインでCareLink予約ページを提供できます（エンタープライズプラン）</p>
      </div>

      {message && (
        <div role={message.ok ? undefined : 'alert'} className={`p-4 rounded-lg text-sm ${message.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
          <button type="button" onClick={() => setMessage(null)} className="ml-2 underline">閉じる</button>
        </div>
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
          <label className="block text-xs font-medium text-gray-700 mb-1">独自ドメイン <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={form.domain}
            onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
            placeholder="booking.yoursite.com"
            maxLength={253}
            disabled={loading}
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">サブドメイン推奨（例: booking.yoursite.com）</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">ブランド名</label>
          <input
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
            <label className="block text-xs font-medium text-gray-700 mb-1">ブランドカラー</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.primary_color}
                onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                className="w-10 h-10 rounded border cursor-pointer"
              />
              <input
                type="text"
                value={form.primary_color}
                onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                maxLength={7}
                className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">ロゴURL（任意）</label>
            <input
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
          disabled={saving || !form.domain}
          className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-600 disabled:opacity-50 transition-colors"
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
            className="bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-600 transition-colors"
          >
            認証を確認する
          </button>
        </div>
      )}

      {/* Verified status */}
      {config?.is_verified && (
        <div className="bg-green-50 rounded-xl p-6">
          <div className="flex items-center gap-2 text-green-700">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="font-semibold">ドメイン認証済み</span>
          </div>
          <p className="text-sm text-green-700 mt-2">
            <strong>{config.domain}</strong> で予約ページが利用可能です
          </p>
          <a
            href={`https://${config.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-3 text-sm text-green-700 underline"
          >
            {config.domain} を開く →
          </a>
        </div>
      )}

      {/* Vercel domain setup guide */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-gray-900 mb-4">設定手順</h2>
        <ol className="text-sm text-gray-700 space-y-3 list-decimal pl-5">
          <li>上記フォームで独自ドメインを入力して保存</li>
          <li>ドメインのDNS管理画面でCNAMEレコードを追加：<br />
            <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">{form.domain || 'booking.yoursite.com'} → cname.vercel-dns.com</code>
          </li>
          <li>TXTレコードを追加してドメインを認証</li>
          <li>Vercel管理画面でカスタムドメインを設定（サポートが代行します）</li>
          <li>認証完了後、即座に独自ドメインで予約ページが利用可能になります</li>
        </ol>
      </div>
    </div>
  );
}
