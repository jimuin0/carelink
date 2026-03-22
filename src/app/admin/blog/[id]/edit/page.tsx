'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import type { BlogPost } from '@/types';

export default function EditBlogPage() {
  const router = useRouter();
  const params = useParams();
  const postId = params.id as string;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).single();
      if (!membership) { setLoading(false); return; }
      setFacilityId(membership.facility_id);
      const { data } = await supabase
        .from('blog_posts')
        .select('*')
        .eq('id', postId)
        .eq('facility_id', membership.facility_id)
        .single();

      if (data) {
        const post = data as BlogPost;
        setTitle(post.title);
        setContent(post.content);
        setIsPublished(post.is_published);
      }
      setLoading(false);
    };
    load().catch(() => setLoading(false));
  }, [postId]);

  const handleSave = async () => {
    if (saving || !title || !content || !facilityId) return;
    setSaving(true);

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase
      .from('blog_posts')
      .update({
        title,
        content,
        is_published: isPublished,
        published_at: isPublished ? new Date().toISOString() : null,
      })
      .eq('id', postId)
      .eq('facility_id', facilityId);

    if (error) {
      setToast({ type: 'error', message: '保存に失敗しました' });
    } else {
      setToast({ type: 'success', message: '保存しました' });
      setTimeout(() => router.push('/admin/blog'), 1000);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirm('この記事を削除しますか？')) return;

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.from('blog_posts').delete().eq('id', postId).eq('facility_id', facilityId ?? '');
    if (error) {
      setToast({ type: 'error', message: '削除に失敗しました' });
      return;
    }
    router.push('/admin/blog');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">ブログ編集</h1>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label htmlFor="blog-title" className="form-label">タイトル <span className="text-red-500">*</span></label>
          <input id="blog-title" value={title} onChange={(e) => setTitle(e.target.value)} className="form-input" />
        </div>
        <div>
          <label htmlFor="blog-content" className="form-label">本文 <span className="text-red-500">*</span></label>
          <textarea id="blog-content" value={content} onChange={(e) => setContent(e.target.value)} className="form-input" rows={12} />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="publish" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
          <label htmlFor="publish" className="text-sm">公開する</label>
        </div>

        <div className="flex items-center gap-3 pt-4">
          <button onClick={() => router.push('/admin/blog')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 !py-3">
            {saving ? '保存中...' : '保存する'}
          </button>
          <button onClick={handleDelete} className="text-sm text-red-500 hover:underline">
            削除
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
