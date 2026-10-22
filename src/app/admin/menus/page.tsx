'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import FacilitySelector from '@/components/admin/FacilitySelector';
import { loadAdminFacilitySelection, type AdminFacilityChoice } from '@/lib/admin-facility-selection';
import { verifyAuthUser } from '@/lib/auth-verification';
import Image from 'next/image';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import Modal from '@/components/Modal';
import LoadError from '@/components/admin/LoadError';
import { SbPageHeader, SbBadge, SbInput } from '@/components/admin/SbUi';
import type { FacilityMenu } from '@/types';
import AdminPageLoading from '@/components/admin/AdminPageLoading';

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

async function fetchMenuSnapshot(facilityId: string) {
  const response = await fetch(`/api/admin/menus?facility_id=${facilityId}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('MENU_READ_UNAVAILABLE');
  const snapshot = await response.json() as { menus: FacilityMenu[]; revision: string | null };
  if (!Array.isArray(snapshot.menus) || !snapshot.menus.every(menu => menu.facility_id === facilityId)
    || (snapshot.revision !== null && typeof snapshot.revision !== 'string')) throw new Error('MENU_SNAPSHOT_INVALID');
  return snapshot;
}

/** 一括公開中を表す publishing の値（メニュー ID とは重ならない）。 */
const PUBLISH_ALL = 'all';

export default function AdminMenusPage() {
  const requested = useSearchParams().get('facility_id');
  return <AdminMenusEditor key={requested ?? 'unselected'} requested={requested} />;
}

function AdminMenusEditor({ requested }: { requested: string | null }) {
  const [choices, setChoices] = useState<AdminFacilityChoice[]>([]);
  const [menus, setMenus] = useState<FacilityMenu[]>([]);
  const [revision, setRevision] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [editForm, setEditForm] = useState<MenuForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // 監査対応: 従来は追加時に末尾固定(sort_order: menus.length)のみで並び替え手段が無かった。
  // カテゴリ内の隣接メニューとsort_orderを交換する↑↓ボタンで並び替えを可能にする。
  const [reordering, setReordering] = useState<string | null>(null);
  // 公開／非公開の切替中のメニュー。HPB 一括反映のメニューは非公開で作られるため、
  // ここから公開しない限りお客様に表示されず、ネット予約も始められない。
  const [publishing, setPublishing] = useState<string | null>(null);

  const loadMenus = useCallback(async (fId: string) => {
    setLoadError(false);
    try {
      const snapshot = await fetchMenuSnapshot(fId);
      setMenus(snapshot.menus); setRevision(snapshot.revision);
    } catch { setLoadError(true); }
  }, []);

  // user→membership→facilityId→一覧取得 の全工程。リトライ時も facilityId を再導出するため
  // 完全再取得をこの単一 effect に集約する（facilityId 未確定の失敗でもリトライが機能する）。
  // retry は再取得を state（reloadKey）経由で駆動する。reload をイベントハンドラからも
  // effect からも呼べる形にすると React Compiler の set-state-in-effect 検出対象になるため、
  // 実処理は effect 側にだけ inline し（loadMenus の外部呼び出しも含めて）、
  // イベントハンドラ側は reloadKey を進めるだけにする。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        setLoading(true);
        setFacilityId(null);
        setLoadError(false);
        const auth = await verifyAuthUser(supabase.auth);
        if (cancelled) return;
        if (auth.state !== 'verified') { setLoadError(true); setLoading(false); return; }
        const selection = await loadAdminFacilitySelection(supabase, auth.user.id, requested);
        if (cancelled) return;
        setChoices(selection.choices);
        if (!selection.selectedId) { setLoading(false); return; }
        setFacilityId(selection.selectedId);
        const snapshot = await fetchMenuSnapshot(selection.selectedId);
        if (cancelled) return;
        setMenus(snapshot.menus); setRevision(snapshot.revision);
        setLoading(false);
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey, requested]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const handleSave = async () => {
    if (!editForm || !facilityId || saving) return;
    if (!editForm.name.trim()) {
      setToast({ type: 'error', message: 'メニュー名を入力してください' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category: editForm.category,
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        price: editForm.price ? parseInt(editForm.price) : null,
        price_note: editForm.price_note.trim() || null,
        duration_minutes: editForm.duration_minutes ? parseInt(editForm.duration_minutes) : null,
        photo_url: editForm.photo_url.trim() || null,
        is_featured: editForm.is_featured,
      };

      let res: Response;
      if (editForm.id) {
        res = await fetch(`/api/admin/menus/${editForm.id}?facility_id=${facilityId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/admin/menus?facility_id=${facilityId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, sort_order: menus.length }),
        });
      }

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '保存に失敗しました' });
        return;
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

  const handleDelete = (id: string) => {
    if (!facilityId || deleting) return;
    setConfirmDeleteId(id);
  };

  const executeDelete = async () => {
    const id = confirmDeleteId;
    if (!id || !facilityId) return;
    setConfirmDeleteId(null);
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/menus/${id}?facility_id=${facilityId}`, { method: 'DELETE' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '削除に失敗しました' });
        return;
      }
      setToast({ type: 'success', message: '削除しました' });
      await loadMenus(facilityId);
    } catch {
      setToast({ type: 'error', message: '削除に失敗しました' });
    } finally {
      setDeleting(null);
    }
  };

  // カテゴリ全体の並び順と取得時のrevisionを、一度の原子操作へ渡す。
  const handleReorder = async (categoryItems: FacilityMenu[], index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (!facilityId || reordering || targetIndex < 0 || targetIndex >= categoryItems.length) return;
    const current = categoryItems[index];
    setReordering(current.id);
    try {
      const ids = categoryItems.map(menu => menu.id);
      const desired = [...ids]; [desired[index], desired[targetIndex]] = [desired[targetIndex], desired[index]];
      const response = await fetch(`/api/admin/menus/reorder?facility_id=${facilityId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu_ids: desired, expected_ids: ids, expected_revision: revision }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        setToast({ type: 'error', message: error.error || '並び替えの結果を確認できませんでした' });
        await loadMenus(facilityId); return;
      }
      await loadMenus(facilityId);
    } catch {
      setToast({ type: 'error', message: '並び替えの結果を確認できませんでした' });
      await loadMenus(facilityId);
    } finally {
      setReordering(null);
    }
  };

  // 送るのは is_published だけ（部分更新）。名前・料金・写真などは DB 側で現在値が保たれる。
  const handleTogglePublish = async (menu: FacilityMenu) => {
    if (!facilityId || publishing) return;
    const publish = menu.is_published === false;
    setPublishing(menu.id);
    try {
      const res = await fetch(`/api/admin/menus/${menu.id}?facility_id=${facilityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_published: publish }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '公開設定を変更できませんでした' });
        return;
      }
      setToast({ type: 'success', message: publish ? '公開しました' : '非公開にしました' });
      await loadMenus(facilityId);
    } catch {
      // 応答だけ失われた可能性があるため、一覧を読み直して実際の状態を表示する。
      setToast({ type: 'error', message: '公開設定を変更できませんでした' });
      await loadMenus(facilityId);
    } finally {
      setPublishing(null);
    }
  };

  // HPB 一括反映の下書き（数十件）を 1 回でまとめて公開する。1 件ずつだとレート制限に当たって途中で止まる。
  const handlePublishAll = async () => {
    if (!facilityId || publishing) return;
    setPublishing(PUBLISH_ALL);
    try {
      const res = await fetch(`/api/admin/menus/publish?facility_id=${facilityId}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ type: 'error', message: body.error || '公開できませんでした' });
        return;
      }
      setToast({ type: 'success', message: typeof body.published === 'number' ? `${body.published}件のメニューを公開しました` : '公開しました' });
      await loadMenus(facilityId);
    } catch {
      // 応答だけ失われた可能性があるため、一覧を読み直して実際の状態を表示する。
      setToast({ type: 'error', message: '公開できませんでした' });
      await loadMenus(facilityId);
    } finally {
      setPublishing(null);
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

  if (loading) return <AdminPageLoading />;
  if (loadError) return <LoadError onRetry={reload} />;
  const selector = <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/menus"
    dirty={editForm !== null} busy={saving || deleting !== null || reordering !== null || publishing !== null} />;
  if (!facilityId) return <div><SbPageHeader title="メニュー管理" />{selector}</div>;

  const grouped = menus.reduce<Record<string, FacilityMenu[]>>((acc, m) => {
    (acc[m.category] = acc[m.category] || []).push(m);
    return acc;
  }, {});
  // is_published が null の旧データは公開扱い（公開側の可視条件 COALESCE(is_published, true) と揃える）。
  const unpublishedCount = menus.filter((m) => m.is_published === false).length;

  return (
    <div>
      <SbPageHeader
        title="メニュー管理"
        actions={
          <button type="button" onClick={() => setEditForm({ ...emptyForm })} className="btn-primary px-5 py-2.5!">
            メニュー追加
          </button>
        }
      />

      {selector}

      {/* Edit/Add Form Modal */}
      {editForm && (
        <Modal
          open
          onClose={() => setEditForm(null)}
          title={editForm.id ? 'メニュー編集' : 'メニュー追加'}
          footer={
            <div className="flex gap-3">
              <button type="button" onClick={() => setEditForm(null)} className="flex-1 py-2.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">キャンセル</button>
              <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1 py-2.5!">{saving ? '保存中...' : '保存'}</button>
            </div>
          }
        >
            <div className="space-y-4">
              <div>
                <label htmlFor="menu-cat" className="form-label">カテゴリ</label>
                <select id="menu-cat" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="form-input">
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="menu-name" className="form-label">メニュー名 <span className="text-red-500">*</span></label>
                <SbInput id="menu-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} maxLength={100} />
              </div>
              <div>
                <label htmlFor="menu-desc" className="form-label">説明</label>
                <textarea id="menu-desc" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="form-input" rows={3} maxLength={500} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="menu-price" className="form-label">料金（税込）</label>
                  <SbInput id="menu-price" type="number" min={0} value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} placeholder="5000" />
                </div>
                <div>
                  <label htmlFor="menu-dur" className="form-label">所要時間（分）</label>
                  <SbInput id="menu-dur" type="number" min={0} value={editForm.duration_minutes} onChange={(e) => setEditForm({ ...editForm, duration_minutes: e.target.value })} placeholder="60" />
                </div>
              </div>
              <div>
                <label htmlFor="menu-note" className="form-label">料金備考</label>
                <SbInput id="menu-note" value={editForm.price_note} onChange={(e) => setEditForm({ ...editForm, price_note: e.target.value })} placeholder="例: 初回限定" maxLength={100} />
              </div>
              <div>
                <label htmlFor="menu-photo" className="form-label">画像URL</label>
                <SbInput id="menu-photo" value={editForm.photo_url} onChange={(e) => setEditForm({ ...editForm, photo_url: e.target.value })} placeholder="https://xxx.supabase.co/storage/v1/..." maxLength={500} />
                {editForm.photo_url && (
                  <div className="mt-2 w-20 h-20 relative rounded-lg overflow-hidden bg-gray-100">
                    <Image src={editForm.photo_url} alt="プレビュー" fill className="object-cover" sizes="80px" unoptimized />
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editForm.is_featured} onChange={(e) => setEditForm({ ...editForm, is_featured: e.target.checked })} className="rounded-sm border-gray-300 text-sky-500 focus:ring-sky-500" />
                <span className="text-sm">おすすめメニューとして表示</span>
              </label>
            </div>
        </Modal>
      )}

      {unpublishedCount > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="status">
          <p>非公開のメニューが{unpublishedCount}件あります。非公開のメニューはお客様に表示されず、ネット予約もできません。各メニューの「公開する」か、下のボタンで公開できます。</p>
          <button
            type="button"
            onClick={handlePublishAll}
            disabled={publishing !== null}
            className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {publishing === PUBLISH_ALL ? '公開しています…' : '非公開のメニューをすべて公開する'}
          </button>
        </div>
      )}

      {/* Menu List */}
      {menus.length === 0 ? (
        <div className="bg-white rounded-xl shadow-xs p-12 text-center">
          <p className="text-gray-400 mb-2">メニューがまだ登録されていません</p>
          <button type="button" onClick={() => setEditForm({ ...emptyForm })} className="text-sm text-sky-600 font-medium hover:underline">最初のメニューを追加する</button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([cat, items]) => (
            <section key={cat}>
              <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">{cat}</h2>
              <div className="bg-white rounded-xl shadow-xs divide-y">
                {items.map((menu, index) => (
                  <div key={menu.id} className="flex items-center gap-4 p-4">
                    <div className="flex flex-col shrink-0">
                      <button
                        type="button"
                        onClick={() => handleReorder(items, index, -1)}
                        disabled={index === 0 || reordering !== null}
                        className="p-1 text-gray-300 hover:text-sky-600 disabled:opacity-30 disabled:hover:text-gray-300 transition-colors"
                        aria-label="上へ"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReorder(items, index, 1)}
                        disabled={index === items.length - 1 || reordering !== null}
                        className="p-1 text-gray-300 hover:text-sky-600 disabled:opacity-30 disabled:hover:text-gray-300 transition-colors"
                        aria-label="下へ"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                    </div>
                    {menu.photo_url && (
                      <div className="shrink-0 w-12 h-12 relative rounded-lg overflow-hidden bg-gray-100">
                        <Image src={menu.photo_url} alt={menu.name} fill className="object-cover" sizes="48px" unoptimized />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{menu.name}</p>
                        {menu.is_published === false && <SbBadge tone="neutral">非公開</SbBadge>}
                        {menu.is_featured && <SbBadge tone="warning">おすすめ</SbBadge>}
                      </div>
                      {menu.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{menu.description}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      {menu.price != null && <p className="font-bold text-sky-600 text-sm">¥{menu.price.toLocaleString()}</p>}
                      {menu.duration_minutes != null && <p className="text-xs text-gray-400">{menu.duration_minutes}分</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTogglePublish(menu)}
                        disabled={publishing !== null}
                        aria-label={menu.is_published === false ? `${menu.name}を公開する` : `${menu.name}を非公開にする`}
                        className={`px-2.5 py-1 text-xs font-bold whitespace-nowrap rounded-md border transition-colors disabled:opacity-50 ${menu.is_published === false
                          ? 'border-sky-300 text-sky-700 hover:bg-sky-50'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                      >
                        {menu.is_published === false ? '公開する' : '非公開にする'}
                      </button>
                      <button type="button" onClick={() => startEdit(menu)} className="p-2 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" aria-label="編集">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button type="button" onClick={() => handleDelete(menu.id)} disabled={deleting === menu.id} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" aria-label="削除">
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
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="メニューを削除"
        message="このメニューを削除しますか？削除すると元に戻せません。"
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        variant="danger"
        onConfirm={executeDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
