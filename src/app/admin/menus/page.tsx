'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import type { FacilityMenu } from '@/types';

const categories = ['カット', 'カラー', 'パーマ', 'トリートメント', 'ヘッドスパ', 'セット', 'エクステ', 'ネイル', 'まつげ', 'エステ', 'リラクゼーション', '鍼灸', '整体', '介護', 'その他'];

interface MenuForm {
  id?: string;
  category: string;
  name: string;
  description: string;
  price: string;
  price_note: string;
  duration_minutes: string;
  photo_url: string;
  is_featured: boolean;
}

const emptyForm: MenuForm = {
  category: 'カット', name: '', description: '', price: '', price_note: '', duration_minutes: '60', photo_url: '', is_featured: false,
};

export default function AdminMenusPage() {
  const [menus, setMenus] = useState<FacilityMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [editForm, setEditForm] = useState<MenuForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadMenus = useCallback(async (fId: string) => {
    const supabase = createBrowserSupabaseClient();
    const { data } = await supabase
      .from('facility_menus')
      .select('*')
      .eq('facility_id', fId)
      .order('sort_order', { ascending: true });
    setMenus((data ?? []) as FacilityMenu[]);
  }, []);

  useEffect(() => {
    const init = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (!membership) { setLoading(false); return; }
      setFacilityId(membership.facility_id);
      await loadMenus(membership.facility_id);
      setLoading(false);
    };
    init().catch(() => setLoading(false));
  }, [loadMenus]);

  const handleSave = async () => {
    if (!editForm || !facilityId || saving) return;
    if (!editForm.name.trim()) {
      setToast({ type: 'error', message: 'メニュー名を入力してください' });
      return;
    }
    setSaving(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const payload = {
        facility_id: facilityId,
        category: editForm.category,
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        price: editForm.price ? parseInt(editForm.price) : null,
        price_note: editForm.price_note.trim() || null,
        duration_minutes: editForm.duration_minutes ? parseInt(editForm.duration_minutes) : null,
        photo_url: editForm.photo_url.trim() || null,
        is_featured: editForm.is_featured,
        updated_at: new Date().toISOString(),
      };

      if (editForm.id) {
        const { error } = await supabase.from('facility_menus').update(payload).eq('id', editForm.id).eq('facility_id', facilityId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('facility_menus').insert({
          ...payload,
          sort_order: menus.length,
        });
        if (error) throw error;
      }
      setToast({ type: 'success', message: editForm.id ? '更新しました' : '追加しました' });
      setEditForm(null);
      await loadMenus(facilityId);
    } catch {
      setToast({ type: 'error', message: '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!facilityId || deleting) return;
    if (!window.confirm('このメニューを削除しますか？')) return;
    setDeleting(id);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.from('facility_menus').delete().eq('id', id).eq('facility_id', facilityId);
      if (error) throw error;
      setToast({ type: 'success', message: '削除しました' });
      await loadMenus(facilityId);
    } catch {
      setToast({ type: 'error', message: '削除に失敗しました' });
    } finally {
      setDeleting(null);
    }
  };

  const startEdit = (menu: FacilityMenu) => {
    setEditForm({
      id: menu.id,
      category: menu.category,
      name: menu.name,
      description: menu.description || '',
      price: menu.price?.toString() || '',
      price_note: menu.price_note || '',
      duration_minutes: menu.duration_minutes?.toString() || '',
      photo_url: menu.photo_url || '',
      is_featured: menu.is_featured,
    });
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
      </div>
    );
  }

  const grouped = menus.reduce<Record<string, FacilityMenu[]>>((acc, m) => {
    (acc[m.category] = acc[m.category] || []).push(m);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">メニュー管理</h1>
        <button onClick={() => setEditForm({ ...emptyForm })} className="btn-primary px-5 !py-2.5">
          メニュー追加
        </button>
      </div>

      {/* Edit/Add Form Modal */}
      {editForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setEditForm(null); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold mb-4">{editForm.id ? 'メニュー編集' : 'メニュー追加'}</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="menu-cat" className="form-label">カテゴリ</label>
                <select id="menu-cat" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="form-input">
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="menu-name" className="form-label">メニュー名 <span className="text-red-500">*</span></label>
                <input id="menu-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="form-input" maxLength={100} />
              </div>
              <div>
                <label htmlFor="menu-desc" className="form-label">説明</label>
                <textarea id="menu-desc" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="form-input" rows={3} maxLength={500} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="menu-price" className="form-label">料金（税込）</label>
                  <input id="menu-price" type="number" min={0} value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} className="form-input" placeholder="5000" />
                </div>
                <div>
                  <label htmlFor="menu-dur" className="form-label">所要時間（分）</label>
                  <input id="menu-dur" type="number" min={0} value={editForm.duration_minutes} onChange={(e) => setEditForm({ ...editForm, duration_minutes: e.target.value })} className="form-input" placeholder="60" />
                </div>
              </div>
              <div>
                <label htmlFor="menu-note" className="form-label">料金備考</label>
                <input id="menu-note" value={editForm.price_note} onChange={(e) => setEditForm({ ...editForm, price_note: e.target.value })} className="form-input" placeholder="例: 初回限定" maxLength={100} />
              </div>
              <div>
                <label htmlFor="menu-photo" className="form-label">画像URL</label>
                <input id="menu-photo" value={editForm.photo_url} onChange={(e) => setEditForm({ ...editForm, photo_url: e.target.value })} className="form-input" placeholder="https://xxx.supabase.co/storage/v1/..." maxLength={500} />
                {editForm.photo_url && (
                  <div className="mt-2 w-20 h-20 relative rounded-lg overflow-hidden bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={editForm.photo_url} alt="プレビュー" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editForm.is_featured} onChange={(e) => setEditForm({ ...editForm, is_featured: e.target.checked })} className="rounded border-gray-300 text-sky-500 focus:ring-sky-500" />
                <span className="text-sm">おすすめメニューとして表示</span>
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditForm(null)} className="flex-1 py-2.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">キャンセル</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 !py-2.5">{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Menu List */}
      {menus.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-gray-400 mb-2">メニューがまだ登録されていません</p>
          <button onClick={() => setEditForm({ ...emptyForm })} className="text-sm text-sky-600 font-medium hover:underline">最初のメニューを追加する</button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([cat, items]) => (
            <section key={cat}>
              <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">{cat}</h2>
              <div className="bg-white rounded-xl shadow-sm divide-y">
                {items.map((menu) => (
                  <div key={menu.id} className="flex items-center gap-4 p-4">
                    {menu.photo_url && (
                      <div className="shrink-0 w-12 h-12 relative rounded-lg overflow-hidden bg-gray-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={menu.photo_url} alt={menu.name} className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{menu.name}</p>
                        {menu.is_featured && <span className="text-micro px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-bold">おすすめ</span>}
                      </div>
                      {menu.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{menu.description}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      {menu.price != null && <p className="font-bold text-sky-600 text-sm">¥{menu.price.toLocaleString()}</p>}
                      {menu.duration_minutes != null && <p className="text-xs text-gray-400">{menu.duration_minutes}分</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => startEdit(menu)} className="p-2 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" aria-label="編集">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button onClick={() => handleDelete(menu.id)} disabled={deleting === menu.id} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" aria-label="削除">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
