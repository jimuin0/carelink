'use client';

import { useState, useEffect, useRef } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { UUID_REGEX } from '@/lib/constants';
import { useConfirmedClipboard } from '@/hooks/useConfirmedClipboard';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';
import { SbBadge, SbPageHeader } from '@/components/admin/SbUi';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import FacilitySelector from '@/components/admin/FacilitySelector';
import AdminFacilityScope, { type AdminFacilityScopeValue } from '@/components/admin/AdminFacilityScope';

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

function isApiKey(value:unknown):value is ApiKey {
  if(!value||typeof value!=='object')return false;
  const key=value as Record<string,unknown>;
  return typeof key.id==='string'&&UUID_REGEX.test(key.id)&&typeof key.name==='string'&&typeof key.key_prefix==='string'&&typeof key.is_active==='boolean'&&typeof key.created_at==='string'&&Array.isArray(key.scopes)&&key.scopes.every(scope=>typeof scope==='string');
}

const AVAILABLE_SCOPES = [
  { value: 'bookings:read', label: '予約 — 読み取り' },
  { value: 'customers:read', label: '顧客 — 読み取り' },
  { value: 'reviews:read', label: '口コミ — 読み取り' },
];

export default function ApiKeysPage() {
  return <AdminFacilityScope title="外部API / APIキー管理" path="/admin/api-keys">{(scope) => <ApiKeysManager {...scope} />}</AdminFacilityScope>;
}

// 店舗は AdminFacilityScope が ?facility_id= と所属から決める（2026年10月22日）。以前は facility_members を
// .limit(1).single() で 1 行だけ読み、一覧・発行・無効化がすべて任意の 1 店舗に固定されていた。
// 発行は API がオーナーに限っている（admin は 403）ため、選んだ店舗での役割を読んで、オーナーでなければ
// 発行欄の代わりに理由を出す（押してから失敗させない）。無効化は API が owner/admin の両方に許している。
function ApiKeysManager({ facilityId, choices, userId }: AdminFacilityScopeValue) {
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['bookings:read']);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [generatedKeyId,setGeneratedKeyId]=useState<string|null>(null);
  const clipboard=useConfirmedClipboard(generatedKeyId);
  const copied=clipboard.status==='copied';
  const creatingRef=useRef(false);
  const revokingRef=useRef(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  // retry は再取得を state 経由で駆動する（load をイベントハンドラからも effect からも
  // 呼べる形にすると Compiler の検出対象になるため、キーの変化で effect 側だけに寄せる）
  const [reloadKey, setReloadKey] = useState(0);

  // アンマウント後の setState を防ぐため cancelled フラグで守りつつ、非同期処理を effect 内へ inline する
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        setLoadError(false);
        const { data: mem, error: memErr } = await supabase.from('facility_members').select('role')
          .eq('user_id', userId).eq('facility_id', facilityId).in('role', ['owner', 'admin']).maybeSingle();
        if (memErr || !mem || (mem.role !== 'owner' && mem.role !== 'admin')) { if (!cancelled) { setLoadError(true); setLoading(false); } return; }
        if (cancelled) return;
        setRole(mem.role);
        const { data, error } = await supabase.from('api_keys').select('id, name, key_prefix, scopes, is_active, last_used_at, expires_at, created_at').eq('facility_id', facilityId).order('created_at', { ascending: false });
        if (error) { if (!cancelled) { setLoadError(true); setLoading(false); } return; }
        if (cancelled) return;
        if(!Array.isArray(data)||!data.every(isApiKey))throw new Error('UNCONFIRMED_KEY_LIST');
        setKeys(data);
        setLoading(false);
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false); }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [facilityId, userId, reloadKey]);

  const handleCreate = async () => {
    if (role !== 'owner' || !newKeyName.trim() || selectedScopes.length === 0 || creatingRef.current) return;
    creatingRef.current=true;
    setCreating(true);

    try {
      const res = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facility_id: facilityId, name: newKeyName.trim(), scopes: selectedScopes }),
      });
      if(res.status>=500)throw new Error('UNCONFIRMED_ISSUANCE');
      const data = await res.json();
      if (res.ok) {
        if(typeof data.raw_key!=='string'||!data.raw_key||!isApiKey(data.key)||data.key.name!==newKeyName.trim()||data.key.is_active!==true)throw new Error('UNCONFIRMED_API_KEY');
        setGeneratedKeyId(data.key.id);
        setGeneratedKey(data.raw_key);
        setKeys((prev) => [data.key, ...prev]);
        setNewKeyName('');
        setSelectedScopes(['bookings:read']);
      } else {
        setToast({ type: 'error', message: typeof data.error==='string'?data.error:'APIキーの作成に失敗しました' });
      }
    } catch {
      setToast({type:'error',message:'APIキーの発行結果を確認できません。一覧を照合してから操作してください。'});
    } finally {
      creatingRef.current=false;
      setCreating(false);
    }
  };

  const handleRevoke = (id: string) => {
    setConfirmRevokeId(id);
    setConfirmRevoke(true);
  };

  const doRevoke = async () => {
    if (!confirmRevokeId||revokingRef.current) return;
    revokingRef.current=true;setConfirmRevoke(false);
    const id=confirmRevokeId;setConfirmRevokeId(null);
    try {
      const res=await fetch(`/api/admin/api-keys/${id}`,{method:'DELETE'});
      if(res.status>=500)throw new Error('UNCONFIRMED_REVOCATION');
      if(res.ok){
        const data=await res.json();if(data.success!==true)throw new Error('UNCONFIRMED_REVOCATION');
        setKeys(prev=>prev.map(key=>key.id===id?{...key,is_active:false}:key));
        setToast({type:'success',message:'APIキーを無効化しました'});
      }else setToast({type:'error',message:'無効化に失敗しました'});
    }catch{setToast({type:'error',message:'無効化の結果を確認できません。一覧を再取得して照合してください。'});}
    finally{revokingRef.current=false;}
  };
  const copyKey=()=>{if(generatedKey)void clipboard.copy(generatedKey);};

  if (loading) return <AdminPageLoading />;

  return (
    <div className="space-y-6 max-w-3xl">
      <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/api-keys" busy={creating}
        dirty={generatedKey !== null || newKeyName.trim() !== ''} />
      <SbPageHeader title="外部API / APIキー管理" description="POS・会計ソフト・カスタムアプリとの連携用APIキーを発行・管理します" />

      {/* Generated key banner */}
      {generatedKey && (
        <div data-clarity-mask="true" className="bg-green-50 border border-green-200 rounded-xl p-5">
          <p className="font-bold text-green-800 mb-1">APIキーを発行しました</p>
          <p className="text-xs text-green-700 mb-3">このキーは一度しか表示されません。今すぐコピーして安全な場所に保管してください。</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-green-200 rounded-lg px-3 py-2 text-sm font-mono break-all">{generatedKey}</code>
            <button type="button" onClick={copyKey} disabled={clipboard.copying}
              className="shrink-0 px-3 py-2 bg-green-500 text-white rounded-lg text-sm font-bold hover:bg-green-600 transition-colors">
              {clipboard.copying?'コピー中...':copied ? '✓ コピー済み' : 'コピー'}
            </button>
          </div>
          {clipboard.status==='failed'&&<p role="alert" className="mt-2 text-sm text-red-600">APIキーをコピーできませんでした。この画面のキーを選択してコピーするか、ブラウザの権限をご確認ください。</p>}
          <button type="button" onClick={() => {setGeneratedKey(null);setGeneratedKeyId(null);}}
            className="mt-3 text-xs text-green-600 hover:underline">
            確認しました・閉じる
          </button>
        </div>
      )}

      {/* Create new key（発行はオーナーのみ。admin には理由を出す） */}
      {role === 'admin' && (
        <section aria-labelledby="key-create-heading" className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 id="key-create-heading" className="font-bold text-gray-800">新しいAPIキーを作成</h2>
          <p className="text-sm text-gray-600 mt-2">APIキーの発行は、この店舗のオーナーのみ行えます。発行が必要な場合はオーナーにご依頼ください。</p>
        </section>
      )}
      {role === 'owner' && (
      <fieldset disabled={creating} aria-labelledby="key-create-heading" className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 id="key-create-heading" className="font-bold text-gray-800">新しいAPIキーを作成</h2>

        <div>
          <label htmlFor="api-key-name" className="block text-xs text-gray-500 mb-1">キー名（用途を分かりやすく）</label>
          <input
            id="api-key-name"
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="例: POS連携、freee自動取込"
            maxLength={50}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-sky-300"
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
                  className="rounded-sm"
                />
                <span className="text-sm text-gray-700">{s.label}</span>
                <code className="text-xs text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-sm">{s.value}</code>
              </label>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleCreate}
          disabled={creating || !newKeyName.trim() || selectedScopes.length === 0}
          className="btn-primary px-5! py-2.5! text-sm"
        >
          {creating ? '作成中...' : 'APIキーを発行する'}
        </button>
      </fieldset>
      )}

      {/* Key list */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">発行済みAPIキー（{keys.length}件）</h2>
        </div>
        {loadError ? (
          <div className="p-4"><LoadError onRetry={() => setReloadKey((k) => k + 1)} message="APIキーの読み込みに失敗しました" /></div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-gray-500 p-6 text-center">APIキーはまだありません</p>
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
                  <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
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
        <p className="mb-1">リクエストヘッダーに <code className="bg-white px-1 rounded-sm text-xs font-mono">Authorization: Bearer {'{YOUR_API_KEY}'}</code> を追加してください。</p>
        <div className="bg-white rounded-lg p-3 font-mono text-xs text-gray-700 mt-2 space-y-1">
          <p>GET /api/v1/bookings?facility_id=xxx&from=2026-04-01&to=2026-04-30</p>
          <p>GET /api/v1/customers?search=田中</p>
        </div>
      </div>
    </div>
  );
}
