'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';

interface FeatureArticle {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  href: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface FeatureForm {
  id?: string;
  title: string;
  subtitle: string;
  image_url: string;
  href: string;
  is_active: boolean;
  sort_order: string;
}

const emptyForm: FeatureForm = {
  title: '', subtitle: '', image_url: '', href: '', is_active: true, sort_order: '0',
};

export default function AdminFeaturesPage() {
  const [features, setFeatures] = useState<FeatureArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [editForm, setEditForm] = useState<FeatureForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadFeatures = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const { data, error } = await supabase
      .from('feature_articles')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) { setLoadError(true); return; }
    setFeatures((data ?? []) as FeatureArticle[]);
  }, []);

  useEffect(() => {
    const init = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (!membership) { setLoading(false); return; }
      await loadFeatures();
      setLoading(false);
    };
    init().catch(() => { setLoadError(true); setLoading(false); });
  }, [loadFeatures]);

  const handleSave = async () => {
    if (!editForm || saving) return;
    if (!editForm.title.trim()) {
      setToast({ type: 'error', message: 'タイトルを入力してください' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: editForm.title.trim(),
        subtitle: editForm.subtitle.trim() || null,
        image_url: editForm.image_url.trim() || null,
        href: editForm.href.trim() || null,
        is_active: editForm.is_active,
        sort_order: editForm.sort_order ? parseInt(editForm.sort_order) : 0,
      };

      let res: Response;
      if (editForm.id) {
        res = await fetch(`/api/admin/features/${editForm.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/admin/features', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) throw new Error();
      setToast({ type: 'success', message: editForm.id ? '更新しました' : '追加しました' });
      setEditForm(null);
      await loadFeatures();
    } catch {
      setToast({ type: 'error', message: '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deleting) return;
    setConfirmDeleteId(id);
  };

  const executeDelete = async () => {
    const id = confirmDeleteId;
    if (!id) return;
    setConfirmDeleteId(null);
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/features/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setToast({ type: 'success', message: '削除しました' });
      await loadFeatures();
    } catch {
      setToast({ type: 'error', message: '削除に失敗しました' });
    } finally {
      setDeleting(null);
    }
  };

  const toggleActive = async (feature: FeatureArticle) => {
    try {
      const res = await fetch(`/api/admin/features/${feature.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !feature.is_active }),
      });
      if (!res.ok) throw new Error();
      setToast({ type: 'success', message: feature.is_active ? '非公開にしました' : '公開にしました' });
      await loadFeatures();
    } catch {
      setToast({ type: 'error', message: '更新に失敗しました' });
    }
  };

  const startEdit = (feature: FeatureArticle) => {
    setEditForm({
      id: feature.id,
      title: feature.title,
      subtitle: feature.subtitle || '',
      image_url: feature.image_url || '',
      href: feature.href || '',
      is_active: feature.is_active,
      sort_order: feature.sort_order.toString(),
    });
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">特集管理</h1>
        <button type="button" onClick={() => setEditForm({ ...emptyForm, sort_order: features.length.toString() })} className="btn-primary px-5 !py-2.5">
          特集を追加
        </button>
      </div>

      {/* Edit/Add Form Modal */}
      {editForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setEditForm(null); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold mb-4">{editForm.id ? '特集を編集' : '特集を追加'}</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="feat-title" className="form-label">タイトル <span className="text-red-500">*</span></label>
                <input id="feat-title" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="form-input" maxLength={100} placeholder="例: 春のヘアスタイル特集" />
              </div>
              <div>
                <label htmlFor="feat-subtitle" className="form-label">サブタイトル</label>
                <input id="feat-subtitle" value={editForm.subtitle} onChange={(e) => setEditForm({ ...editForm, subtitle: e.target.value })} className="form-input" maxLength={200} placeholder="例: トレンドの春カラーをチェック" />
              </div>
              <div>
                <label htmlFor="feat-image" className="form-label">画像URL</label>
                <input id="feat-image" value={editForm.image_url} onChange={(e) => setEditForm({ ...editForm, image_url: e.target.value })} className="form-input" maxLength={500} placeholder="https://xxx.supabase.co/storage/v1/..." />
                {editForm.image_url && (
                  <div className="mt-2 w-full h-32 relative rounded-lg overflow-hidden bg-gray-100">
                    <Image src={editForm.image_url} alt="プレビュー" fill className="object-cover" sizes="100%" unoptimized />
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="feat-href" className="form-label">リンクURL</label>
                <input id="feat-href" value={editForm.href} onChange={(e) => setEditForm({ ...editForm, href: e.target.value })} className="form-input" maxLength={500} placeholder="例: /search?keyword=春カラー" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="feat-order" className="form-label">表示順</label>
                  <input id="feat-order" type="number" min={0} value={editForm.sort_order} onChange={(e) => setEditForm({ ...editForm, sort_order: e.target.value })} className="form-input" />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} className="rounded border-gray-300 text-sky-500 focus:ring-sky-500" />
                    <span className="text-sm">公開する</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setEditForm(null)} className="flex-1 py-2.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">キャンセル</button>
              <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1 !py-2.5">{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Feature List */}
      {loadError ? (
        <LoadError onRetry={loadFeatures} message="特集の読み込みに失敗しました" />
      ) : features.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-gray-400 mb-2">特集がまだ登録されていません</p>
          <button type="button" onClick={() => setEditForm({ ...emptyForm })} className="text-sm text-sky-600 font-medium hover:underline">最初の特集を追加する</button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm divide-y">
          {features.map((feature) => (
            <div key={feature.id} className="flex items-center gap-4 p-4">
              {feature.image_url ? (
                <div className="shrink-0 w-16 h-12 relative rounded-lg overflow-hidden bg-gray-100">
                  <Image src={feature.image_url} alt={feature.title} fill className="object-cover" sizes="64px" unoptimized />
                </div>
              ) : (
                <div className="shrink-0 w-16 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{feature.title}</p>
                  <span className={`text-micro px-1.5 py-0.5 rounded-full font-bold ${feature.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {feature.is_active ? '公開' : '非公開'}
                  </span>
                </div>
                {feature.subtitle && <p className="text-xs text-gray-400 mt-0.5 truncate">{feature.subtitle}</p>}
                <p className="text-xs text-gray-300 mt-0.5">順序: {feature.sort_order}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button type="button" onClick={() => toggleActive(feature)} className="p-2 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" aria-label={feature.is_active ? '非公開にする' : '公開にする'}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {feature.is_active
                      ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                    }
                  </svg>
                </button>
                <button type="button" onClick={() => startEdit(feature)} className="p-2 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" aria-label="編集">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                <button type="button" onClick={() => handleDelete(feature.id)} disabled={deleting === feature.id} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" aria-label="削除">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="特集を削除"
        message="この特集を削除しますか？削除すると元に戻せません。"
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        onConfirm={executeDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
