'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

export default function NewCatalogPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleCreate = async () => {
    if (saving || !title) return;
    setSaving(true);

    const supabase = createBrowserSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const { data: membership } = await supabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .single();

    if (!membership) { setSaving(false); return; }

    const { error } = await supabase.from('treatment_catalogs').insert({
      facility_id: membership.facility_id,
      title,
      description: description || null,
      tags: tags ? tags.split(',').map((t) => t.trim()) : [],
    });

    if (error) {
      setToast({ type: 'error', message: '作成に失敗しました' });
    } else {
      router.push('/admin/catalog');
    }
    setSaving(false);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">カタログ新規追加</h1>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label htmlFor="catalog-title" className="form-label">タイトル <span className="text-red-500">*</span></label>
          <input id="catalog-title" value={title} onChange={(e) => setTitle(e.target.value)} className="form-input" />
        </div>
        <div>
          <label htmlFor="catalog-desc" className="form-label">説明</label>
          <textarea id="catalog-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="form-input" rows={3} />
        </div>
        <div>
          <label htmlFor="catalog-tags" className="form-label">タグ（カンマ区切り）</label>
          <input id="catalog-tags" value={tags} onChange={(e) => setTags(e.target.value)} className="form-input" placeholder="ショートヘア, ボブ, カラー" />
        </div>

        <div className="flex gap-3 pt-4">
          <button onClick={() => router.push('/admin/catalog')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
          <button onClick={handleCreate} disabled={saving} className="btn-primary flex-1 !py-3">
            {saving ? '保存中...' : 'カタログを追加'}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
