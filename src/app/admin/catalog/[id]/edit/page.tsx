'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { SbInput, SbPageHeader } from '@/components/admin/SbUi';

const TAGS_EXAMPLE = ['ショートヘア', 'ボブ', 'カラー'].join('、');

export default function EditCatalogPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createBrowserSupabaseClient();
      const { data, error } = await supabase
        .from('treatment_catalogs')
        .select('title, description, tags')
        .eq('id', params.id)
        .single();
      if (error || !data) {
        setToast({ type: 'error', message: 'カタログの取得に失敗しました' });
      } else {
        setTitle(data.title ?? '');
        setDescription(data.description ?? '');
        setTags((data.tags ?? []).join(', '));
      }
      setLoading(false);
    })();
  }, [params.id]);

  const handleUpdate = async () => {
    if (saving || !title) return;
    setSaving(true);

    const res = await fetch(`/api/admin/catalog/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: title,
        description: description || null,
        tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : null,
      }),
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setToast({ type: 'error', message: e.error || '更新に失敗しました' });
    } else {
      router.push('/admin/catalog');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setConfirmOpen(false);

    const res = await fetch(`/api/admin/catalog/${params.id}`, { method: 'DELETE' });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setToast({ type: 'error', message: e.error || '削除に失敗しました' });
      setDeleting(false);
    } else {
      router.push('/admin/catalog');
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-400">読み込み中...</div>;
  }

  return (
    <div>
      <SbPageHeader title="カタログ編集" />

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label htmlFor="catalog-title" className="form-label">タイトル <span className="text-red-500">*</span></label>
          <SbInput id="catalog-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>
        <div>
          <label htmlFor="catalog-desc" className="form-label">説明</label>
          <textarea id="catalog-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="form-input" rows={3} maxLength={2000} />
        </div>
        <div>
          <label htmlFor="catalog-tags" className="form-label">タグ（カンマ区切り）</label>
          <SbInput id="catalog-tags" value={tags} onChange={(e) => setTags(e.target.value)} maxLength={200} title={TAGS_EXAMPLE} />
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-4">
          <p className="text-xs font-bold text-amber-800 mb-1">⚠️ 医療広告ガイドラインに関する注意</p>
          <p className="text-xs text-amber-700">
            Before/After写真を掲載する場合、施術内容・リスク・費用を明記し、「効果には個人差があります」等の注意書きを添える必要があります。
            誇大広告や虚偽広告は法律で禁止されています。
          </p>
        </div>

        <div className="flex gap-3 pt-4">
          <button type="button" onClick={() => router.push('/admin/catalog')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
          <button type="button" onClick={handleUpdate} disabled={saving} className="btn-primary flex-1 !py-3">
            {saving ? '保存中...' : '更新する'}
          </button>
          <button type="button" onClick={() => setConfirmOpen(true)} disabled={deleting} className="text-sm text-red-600 hover:underline">
            {deleting ? '削除中...' : '削除'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="カタログを削除"
        message="このカタログを削除しますか？"
        confirmLabel="削除する"
        variant="danger"
        confirmDisabled={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
