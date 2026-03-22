'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

export default function NewBlogPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleCreate = async () => {
    if (saving || !title || !content) return;
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

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]+/g, '-')
      .replace(/^-|-$/g, '')
      || `post-${Date.now()}`;

    const { error } = await supabase.from('blog_posts').insert({
      facility_id: membership.facility_id,
      title,
      slug,
      content,
      is_published: isPublished,
      published_at: isPublished ? new Date().toISOString() : null,
    });

    if (error) {
      setToast({ type: 'error', message: '作成に失敗しました' });
    } else {
      router.push('/admin/blog');
    }
    setSaving(false);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">ブログ新規作成</h1>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label className="form-label">タイトル <span className="text-red-500">*</span></label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="form-input" />
        </div>
        <div>
          <label className="form-label">本文 <span className="text-red-500">*</span></label>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} className="form-input" rows={12} />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="publish" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
          <label htmlFor="publish" className="text-sm">公開する</label>
        </div>

        <div className="flex gap-3 pt-4">
          <button onClick={() => router.push('/admin/blog')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
          <button onClick={handleCreate} disabled={saving} className="btn-primary flex-1 !py-3">
            {saving ? '保存中...' : '記事を作成'}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
