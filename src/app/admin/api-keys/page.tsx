'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';
import { SbBadge } from '@/components/admin/SbUi';
import AdminPageLoading from '@/components/admin/AdminPageLoading';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

const AVAILABLE_SCOPES = [
  { value: 'bookings:read', label: '予約 — 読み取り' },
  { value: 'customers:read', label: '顧客 — 読み取り' },
  { value: 'reviews:read', label: '口コミ — 読み取り' },
];

export default function ApiKeysPage() {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['bookings:read']);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: mem, error: memErr } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
    if (memErr && memErr.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
    if (!mem) { setLoading(false); return; }
    setFacilityId(mem.facility_id);
    const { data, error } = await supabase.from('api_keys').select('*').eq('facility_id', mem.facility_id).order('created_at', { ascending: false });
    if (error) { setLoadError(true); setLoading(false); return; }
    setKeys((data ?? []) as ApiKey[]);
    setLoading(false);
  }, []);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  const handleCreate = async () => {
    if (!facilityId || !newKeyName.trim() || selectedScopes.length === 0) return;
    setCreating(true);

    try {
      const res = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facility_id: facilityId, name: newKeyName.trim(), scopes: selectedScopes }),
      });
      const data = await res.json();
      if (res.ok) {
        setGeneratedKey(data.raw_key);
        setKeys((prev) => [data.key, ...prev]);
        setNewKeyName('');
        setSelectedScopes(['bookings:read']);
      } else {
        setToast({ type: 'error', message: data.error || 'APIキーの作成に失敗しました' });
      }
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = (id: string) => {
    setConfirmRevokeId(id);
    setConfirmRevoke(true);
  };

  const doRevoke = async () => {
    if (!confirmRevokeId) return;
    setConfirmRevoke(false);
    const id = confirmRevokeId;
    setConfirmRevokeId(null);
    const res = await fetch(`/api/admin/api-keys/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setKeys((prev) => prev.map((k) => k.id === id ? { ...k, is_active: false } : k));
      setToast({ type: 'success', message: 'APIキーを無効化しました' });
    } else {
      setToast({ type: 'error', message: '無効化に失敗しました' });
    }
  };

  const copyKey = () => {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <AdminPageLoading />;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">外部API / APIキー管理</h1>
        <p className="text-xs text-gray-400 mt-0.5">POS・会計ソフト・カスタムアプリとの連携用APIキーを発行・管理します</p>
      </div>

      {/* Generated key banner */}
      {generatedKey && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <p className="font-bold text-green-800 mb-1">APIキーを発行しました</p>
          <p className="text-xs text-green-700 mb-3">このキーは一度しか表示されません。今すぐコピーして安全な場所に保管してください。</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-green-200 rounded-lg px-3 py-2 text-sm font-mono break-all">{generatedKey}</code>
            <button type="button" onClick={copyKey}
              className="shrink-0 px-3 py-2 bg-green-500 text-white rounded-lg text-sm font-bold hover:bg-green-600 transition-colors">
              {copied ? '✓ コピー済み' : 'コピー'}
            </button>
          </div>
          <button type="button" onClick={() => setGeneratedKey(null)}
            className="mt-3 text-xs text-green-600 hover:underline">
            確認しました・閉じる
          </button>
        </div>
      )}

      {/* Create new key */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-bold text-gray-800">新しいAPIキーを作成</h2>

        <div>
          <label className="block text-xs text-gray-500 mb-1">キー名（用途を分かりやすく）</label>
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="例: POS連携、freee自動取込"
            maxLength={50}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-2">スコープ（アクセス権限）</label>
          <div className="space-y-2">
            {AVAILABLE_SCOPES.map((s) => (
              <label key={s.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(s.value)}
                  onChange={(e) => {
                    setSelectedScopes((prev) => e.target.checked ? [...prev, s.value] : prev.filter((x) => x !== s.value));
                  }}
                  className="rounded"
                />
                <span className="text-sm text-gray-700">{s.label}</span>
                <code className="text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{s.value}</code>
              </label>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleCreate}
          disabled={creating || !newKeyName.trim() || selectedScopes.length === 0}
          className="px-5 py-2.5 bg-sky-600 text-white rounded-lg font-bold text-sm hover:bg-sky-700 disabled:opacity-50 transition-colors"
        >
          {creating ? '作成中...' : 'APIキーを発行する'}
        </button>
      </div>

      {/* Key list */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">発行済みAPIキー（{keys.length}件）</h2>
        </div>
        {loadError ? (
          <div className="p-4"><LoadError onRetry={load} message="APIキーの読み込みに失敗しました" /></div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-gray-400 p-6 text-center">APIキーはまだありません</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {keys.map((key) => (
              <div key={key.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900">{key.name}</span>
                    <SbBadge tone={key.is_active ? 'success' : 'danger'}>
                      {key.is_active ? '有効' : '無効'}
                    </SbBadge>
                  </div>
                  <p className="text-xs font-mono text-gray-500">{key.key_prefix}••••••••</p>
                  <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                    <span>スコープ: {key.scopes.join(', ')}</span>
                    {key.last_used_at && <span>最終利用: {new Date(key.last_used_at).toLocaleDateString('ja-JP')}</span>}
                    <span>発行: {new Date(key.created_at).toLocaleDateString('ja-JP')}</span>
                  </div>
                </div>
                {key.is_active && (
                  <button type="button" onClick={() => handleRevoke(key.id)}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                    無効化
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmRevoke}
        title="APIキーを無効化"
        message="このAPIキーを無効化しますか？一度無効化すると元に戻せません。"
        confirmLabel="無効化する"
        onConfirm={doRevoke}
        onCancel={() => { setConfirmRevoke(false); setConfirmRevokeId(null); }}
      />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      {/* API docs link */}
      <div className="bg-sky-50 rounded-xl p-5 text-sm text-sky-800">
        <p className="font-bold mb-2">API 使い方</p>
        <p className="mb-1">リクエストヘッダーに <code className="bg-white px-1 rounded text-xs font-mono">Authorization: Bearer {'{YOUR_API_KEY}'}</code> を追加してください。</p>
        <div className="bg-white rounded-lg p-3 font-mono text-xs text-gray-700 mt-2 space-y-1">
          <p>GET /api/v1/bookings?facility_id=xxx&from=2026-04-01&to=2026-04-30</p>
          <p>GET /api/v1/customers?search=田中</p>
        </div>
      </div>
    </div>
  );
}
