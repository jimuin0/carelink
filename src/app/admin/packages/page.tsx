'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { SbTable, SbThead, SbTh, SbTbody, SbTd, SbPageHeader } from '@/components/admin/SbUi';
import AdminPageLoading from '@/components/admin/AdminPageLoading';

interface ServicePackage {
  id: string;
  name: string;
  description: string | null;
  session_count: number;
  bonus_count: number;
  price: number;
  valid_days: number;
  is_active: boolean;
  notes: string | null;
  menus: { name: string } | null;
}

interface UserPackage {
  id: string;
  sessions_total: number;
  sessions_remaining: number;
  purchased_at: string;
  expires_at: string | null;
  notes: string | null;
  service_packages: { name: string } | null;
  profiles: { display_name: string; email: string } | null;
}

export default function PackagesPage() {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [userPackages, setUserPackages] = useState<UserPackage[]>([]);
  const [menus, setMenus] = useState<{ id: string; name: string }[]>([]);
  const [tab, setTab] = useState<'packages' | 'users'>('packages');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeletePkg, setConfirmDeletePkg] = useState<ServicePackage | null>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    menu_id: '',
    session_count: 5,
    bonus_count: 1,
    price: 0,
    valid_days: 365,
    notes: '',
  });

  const loadFacility = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data, error } = await supabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .limit(1).single();
    // facility 解決失敗を握り潰すと facilityId 未設定のまま loadPackages が走らず無限スピナーになる。
    // DB エラーは LoadError で明示、no-row（施設未所属）はスピナーを止めて空状態に委ねる。
    if (error && error.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
    if (data?.facility_id) setFacilityId(data.facility_id);
    else setLoading(false);
  }, []);

  const loadPackages = useCallback(async (fId: string) => {
    setLoadError(false);
    try {
      const [pkgRes, upRes, menuRes] = await Promise.all([
        fetch(`/api/admin/packages?facility_id=${fId}`),
        fetch(`/api/admin/user-packages?facility_id=${fId}`),
        (async () => {
          const supabase = createBrowserSupabaseClient();
          return supabase.from('facility_menus').select('id, name').eq('facility_id', fId).order('sort_order');
        })(),
      ]);

      // パッケージ・購入履歴は本画面の主データ。取得失敗を空（0件）に偽装せず明示する
      if (!pkgRes.ok || !upRes.ok) { setLoadError(true); return; }
      const d = await pkgRes.json();
      setPackages(d.packages ?? []);
      const upD = await upRes.json();
      setUserPackages(upD.user_packages ?? []);
      // メニューはフォーム補助。取得失敗時は空のままにし主データの表示は妨げない
      if (menuRes.data) setMenus(menuRes.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFacility().catch(() => { setLoadError(true); setLoading(false); }); }, [loadFacility]);
  useEffect(() => { if (facilityId) loadPackages(facilityId); }, [facilityId, loadPackages]);

  const handleCreate = async () => {
    if (!facilityId || saving) return;
    setSaving(true);
    const res = await fetch(`/api/admin/packages?facility_id=${facilityId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        menu_id: form.menu_id || null,
        session_count: Number(form.session_count),
        bonus_count: Number(form.bonus_count),
        price: Number(form.price),
        valid_days: Number(form.valid_days),
      }),
    });
    if (res.ok) {
      setToast({ type: 'success', message: 'パッケージを作成しました' });
      setShowForm(false);
      setForm({ name: '', description: '', menu_id: '', session_count: 5, bonus_count: 1, price: 0, valid_days: 365, notes: '' });
      loadPackages(facilityId);
    } else {
      const e = await res.json().catch(() => ({}));
      setToast({ type: 'error', message: e.error || '作成に失敗しました' });
    }
    setSaving(false);
  };

  const handleToggleActive = async (pkg: ServicePackage) => {
    if (!facilityId || togglingId) return;
    setTogglingId(pkg.id);
    try {
      const res = await fetch(`/api/admin/packages/${pkg.id}?facility_id=${facilityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !pkg.is_active }),
      });
      if (res.ok) {
        setPackages((prev) => prev.map((p) => p.id === pkg.id ? { ...p, is_active: !p.is_active } : p));
      } else {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '更新に失敗しました' });
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = (pkg: ServicePackage) => {
    setConfirmDeletePkg(pkg);
    setConfirmDelete(true);
  };

  const doDelete = async () => {
    if (!confirmDeletePkg || !facilityId) return;
    setConfirmDelete(false);
    const pkg = confirmDeletePkg;
    setConfirmDeletePkg(null);
    const res = await fetch(`/api/admin/packages/${pkg.id}?facility_id=${facilityId}`, { method: 'DELETE' });
    if (res.ok) {
      setToast({ type: 'success', message: '削除しました' });
      loadPackages(facilityId);
    } else {
      const e = await res.json().catch(() => ({}));
      setToast({ type: 'error', message: e.error || '削除に失敗しました' });
    }
  };

  if (loading) return <AdminPageLoading />;

  return (
    <div className="space-y-5 max-w-4xl">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <SbPageHeader
        title="回数券・パッケージ管理"
        actions={
          <button type="button" onClick={() => setShowForm(true)} className="btn-primary text-sm !px-4 !py-1.5">
            + 新規作成
          </button>
        }
      />

      {/* タブ */}
      <div className="flex border-b">
        {(['packages', 'users'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t ? 'border-sky-500 text-sky-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'packages' ? `パッケージ（${packages.length}）` : `購入履歴（${userPackages.length}）`}
          </button>
        ))}
      </div>

      {/* 新規作成フォーム */}
      {showForm && (
        <div className="bg-white rounded-xl border border-sky-100 p-5 space-y-4">
          <h2 className="font-bold text-sm text-gray-700">新規パッケージ</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pkg-name" className="text-xs text-gray-500 block mb-1">名前 <span className="text-red-500">*</span></label>
              <input id="pkg-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="5回券（お得パック）" maxLength={100} />
            </div>
            <div>
              <label htmlFor="pkg-menu" className="text-xs text-gray-500 block mb-1">対象メニュー</label>
              <select id="pkg-menu" value={form.menu_id} onChange={(e) => setForm({ ...form, menu_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">全メニュー共通</option>
                {menus.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="pkg-description" className="text-xs text-gray-500 block mb-1">説明</label>
            <textarea id="pkg-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="5回ご利用で1回分無料のお得なパッケージ" maxLength={500} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="pkg-session-count" className="text-xs text-gray-500 block mb-1">購入回数</label>
              <input id="pkg-session-count" type="number" value={form.session_count} onChange={(e) => setForm({ ...form, session_count: parseInt(e.target.value) || 1 })}
                min={1} max={100} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="pkg-bonus-count" className="text-xs text-gray-500 block mb-1">ボーナス回数</label>
              <input id="pkg-bonus-count" type="number" value={form.bonus_count} onChange={(e) => setForm({ ...form, bonus_count: parseInt(e.target.value) || 0 })}
                min={0} max={50} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="pkg-price" className="text-xs text-gray-500 block mb-1">価格（円）</label>
              <input id="pkg-price" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
                min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="pkg-valid-days" className="text-xs text-gray-500 block mb-1">有効期限（日）</label>
              <input id="pkg-valid-days" type="number" value={form.valid_days} onChange={(e) => setForm({ ...form, valid_days: parseInt(e.target.value) || 365 })}
                min={1} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 border border-gray-300 rounded-lg">キャンセル</button>
            <button type="button" onClick={handleCreate} disabled={saving || !form.name}
              className="btn-primary !px-6 !py-2 text-sm">
              {saving ? '保存中...' : '作成'}
            </button>
          </div>
        </div>
      )}

      {loadError ? (
        <LoadError onRetry={() => { if (facilityId) loadPackages(facilityId); }} message="パッケージの読み込みに失敗しました" />
      ) : (
      <>
      {/* パッケージ一覧 */}
      {tab === 'packages' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {packages.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              パッケージがありません。「+ 新規作成」から追加してください。
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {packages.map((pkg) => (
                <div key={pkg.id} className={`px-4 py-4 flex items-start gap-4 ${!pkg.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-800">{pkg.name}</span>
                      {pkg.bonus_count > 0 && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                          {pkg.session_count}回 +{pkg.bonus_count}回ボーナス
                        </span>
                      )}
                    </div>
                    {pkg.description && <p className="text-xs text-gray-400 mt-0.5">{pkg.description}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                      <span>¥{pkg.price.toLocaleString()}</span>
                      <span>合計 {pkg.session_count + pkg.bonus_count}回</span>
                      <span>{pkg.valid_days}日有効</span>
                      {pkg.menus && <span className="text-sky-600">{pkg.menus.name}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => handleToggleActive(pkg)} disabled={togglingId === pkg.id}
                      className={`text-xs px-2 py-1 rounded-full font-medium disabled:opacity-50 ${pkg.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {pkg.is_active ? '公開中' : '非公開'}
                    </button>
                    <button type="button" onClick={() => handleDelete(pkg)} className="text-xs text-red-500 hover:underline">削除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 購入履歴 */}
      {tab === 'users' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {userPackages.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">購入履歴がありません</div>
          ) : (
            <SbTable>
              <SbThead>
                <SbTh>ユーザー</SbTh>
                <SbTh>パッケージ</SbTh>
                <SbTh className="hidden sm:table-cell">残回数</SbTh>
                <SbTh className="hidden md:table-cell">有効期限</SbTh>
                <SbTh className="hidden md:table-cell">購入日</SbTh>
              </SbThead>
              <SbTbody>
                {userPackages.map((up) => (
                  <tr key={up.id}>
                    <SbTd className="text-xs">
                      <p className="font-medium text-gray-800">{up.profiles?.display_name || '不明'}</p>
                      <p className="text-gray-400">{up.profiles?.email}</p>
                    </SbTd>
                    <SbTd className="text-xs text-gray-700">{up.service_packages?.name}</SbTd>
                    <SbTd className="hidden sm:table-cell">
                      <span className={`text-xs font-bold ${up.sessions_remaining > 0 ? 'text-sky-600' : 'text-gray-400'}`}>
                        {up.sessions_remaining}/{up.sessions_total}回
                      </span>
                    </SbTd>
                    <SbTd className="text-xs text-gray-400 hidden md:table-cell">
                      {up.expires_at ? new Date(up.expires_at).toLocaleDateString('ja-JP') : '無期限'}
                    </SbTd>
                    <SbTd className="text-xs text-gray-400 hidden md:table-cell">
                      {new Date(up.purchased_at).toLocaleDateString('ja-JP')}
                    </SbTd>
                  </tr>
                ))}
              </SbTbody>
            </SbTable>
          )}
        </div>
      )}
      </>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="パッケージを削除"
        message={`「${confirmDeletePkg?.name}」を削除しますか？`}
        confirmLabel="削除する"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => { setConfirmDelete(false); setConfirmDeletePkg(null); }}
      />
    </div>
  );
}
