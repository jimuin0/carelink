'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

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
  const [saving, setSaving] = useState(false);
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
    if (!user) return;
    const { data } = await supabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .limit(1).single();
    if (data?.facility_id) setFacilityId(data.facility_id);
  }, []);

  const loadPackages = useCallback(async (fId: string) => {
    const [pkgRes, upRes, menuRes] = await Promise.all([
      fetch(`/api/admin/packages?facility_id=${fId}`),
      fetch(`/api/admin/user-packages?facility_id=${fId}`),
      (async () => {
        const supabase = createBrowserSupabaseClient();
        return supabase.from('facility_menus').select('id, name').eq('facility_id', fId).order('sort_order');
      })(),
    ]);

    if (pkgRes.ok) {
      const d = await pkgRes.json();
      setPackages(d.packages ?? []);
    }
    if (upRes.ok) {
      const d = await upRes.json();
      setUserPackages(d.user_packages ?? []);
    }
    if (menuRes.data) setMenus(menuRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadFacility(); }, [loadFacility]);
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
    if (!facilityId) return;
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

  if (loading) {
    return <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">回数券・パッケージ管理</h1>
        <button type="button" onClick={() => setShowForm(true)} className="text-sm px-4 py-1.5 bg-sky-500 text-white rounded-lg hover:bg-sky-600 font-medium">
          + 新規作成
        </button>
      </div>

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
              <label className="text-xs text-gray-500 block mb-1">名前 <span className="text-red-500">*</span></label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="5回券（お得パック）" maxLength={100} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">対象メニュー</label>
              <select value={form.menu_id} onChange={(e) => setForm({ ...form, menu_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">全メニュー共通</option>
                {menus.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">説明</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="5回ご利用で1回分無料のお得なパッケージ" maxLength={500} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">購入回数</label>
              <input type="number" value={form.session_count} onChange={(e) => setForm({ ...form, session_count: parseInt(e.target.value) || 1 })}
                min={1} max={100} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">ボーナス回数</label>
              <input type="number" value={form.bonus_count} onChange={(e) => setForm({ ...form, bonus_count: parseInt(e.target.value) || 0 })}
                min={0} max={50} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">価格（円）</label>
              <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
                min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">有効期限（日）</label>
              <input type="number" value={form.valid_days} onChange={(e) => setForm({ ...form, valid_days: parseInt(e.target.value) || 365 })}
                min={1} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 border border-gray-300 rounded-lg">キャンセル</button>
            <button type="button" onClick={handleCreate} disabled={saving || !form.name}
              className="px-6 py-2 text-sm bg-sky-500 text-white rounded-lg hover:bg-sky-600 disabled:opacity-50 font-medium">
              {saving ? '保存中...' : '作成'}
            </button>
          </div>
        </div>
      )}

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
                    <button type="button" onClick={() => handleToggleActive(pkg)}
                      className={`text-xs px-2 py-1 rounded-full font-medium ${pkg.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
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
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">ユーザー</th>
                  <th className="text-left px-4 py-3 font-medium">パッケージ</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">残回数</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">有効期限</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">購入日</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {userPackages.map((up) => (
                  <tr key={up.id}>
                    <td className="px-4 py-3 text-xs">
                      <p className="font-medium text-gray-800">{up.profiles?.display_name || '不明'}</p>
                      <p className="text-gray-400">{up.profiles?.email}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">{up.service_packages?.name}</td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className={`text-xs font-bold ${up.sessions_remaining > 0 ? 'text-sky-600' : 'text-gray-400'}`}>
                        {up.sessions_remaining}/{up.sessions_total}回
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell">
                      {up.expires_at ? new Date(up.expires_at).toLocaleDateString('ja-JP') : '無期限'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell">
                      {new Date(up.purchased_at).toLocaleDateString('ja-JP')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="パッケージを削除"
        message={`「${confirmDeletePkg?.name}」を削除しますか？`}
        confirmLabel="削除する"
        onConfirm={doDelete}
        onCancel={() => { setConfirmDelete(false); setConfirmDeletePkg(null); }}
      />
    </div>
  );
}
