'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { SbInput, SbPageHeader } from '@/components/admin/SbUi';
import type { BlogPost } from '@/types';
import AdminPageLoading from '@/components/admin/AdminPageLoading';

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  return '#';
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function simpleMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\[(.+?)\]\((.+?)\)/g, (_, label, url) => `<a href="${escapeAttr(sanitizeUrl(url))}" class="text-sky-600 underline">${label}</a>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

export default function EditBlogPage() {
  const router = useRouter();
  const params = useParams();
  const postId = params.id as string;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  const [showPreview, setShowPreview] = useState(false);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const insertMd = (before: string, after: string) => {
    const el = document.getElementById('blog-content') as HTMLTextAreaElement | null;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.substring(start, end);
    const newContent = content.substring(0, start) + before + selected + after + content.substring(end);
    setContent(newContent);
    setTimeout(() => { el.focus(); el.setSelectionRange(start + before.length, end + before.length); }, 0);
  };

  const load = useCallback(async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: membership, error: memErr } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (memErr && memErr.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
      if (!membership) { setLoading(false); return; }
      setFacilityId(membership.facility_id);
      const { data, error } = await supabase
        .from('blog_posts')
        .select('*')
        .eq('id', postId)
        .eq('facility_id', membership.facility_id)
        .single();

      if (error) { setLoadError(true); setLoading(false); return; }
      if (data) {
        const post = data as BlogPost;
        setTitle(post.title);
        setContent(post.content);
        setIsPublished(post.is_published);
      }
      setLoading(false);
  }, [postId]);

  useEffect(() => {
    load().catch(() => { setLoadError(true); setLoading(false); });
  }, [load]);

  const handleSave = async () => {
    if (saving || !title || !content || !facilityId) return;
    setSaving(true);

    const res = await fetch(`/api/admin/blog/${postId}?facility_id=${facilityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, is_published: isPublished }),
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setToast({ type: 'error', message: e.error || '保存に失敗しました' });
    } else {
      setDirty(false);
      setToast({ type: 'success', message: '保存しました' });
      setTimeout(() => router.push('/admin/blog'), 1000);
    }
    setSaving(false);
  };

  const handleDelete = () => {
    setConfirmDelete(true);
  };

  const doDelete = async () => {
    setConfirmDelete(false);
    if (!facilityId) return;
    const res = await fetch(`/api/admin/blog/${postId}?facility_id=${facilityId}`, { method: 'DELETE' });
    if (!res.ok) {
      setToast({ type: 'error', message: '削除に失敗しました' });
      return;
    }
    router.push('/admin/blog');
  };

  if (loading) return <AdminPageLoading />;

  // 取得失敗時はフォームを描画しない（空フォームを保存して実データを上書きする事故を防ぐ）
  if (loadError) {
    return (
      <div>
        <SbPageHeader title="ブログ編集" />
        <LoadError onRetry={load} message="記事の読み込みに失敗しました" />
      </div>
    );
  }

  return (
    <div onChange={() => setDirty(true)}>
      <SbPageHeader title="ブログ編集" />

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label htmlFor="blog-title" className="form-label">タイトル <span className="text-red-500">*</span></label>
          <SbInput id="blog-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>
        <div>
          <label htmlFor="blog-content" className="form-label">
            本文 <span className="text-red-500">*</span>
            <span className="text-xs text-gray-400 ml-2">Markdown記法対応（**太字** / ## 見出し / - リスト）</span>
          </label>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex gap-1 bg-gray-50 border-b px-3 py-2">
              <button type="button" onClick={() => insertMd('**', '**')} className="text-xs px-2 py-1 rounded hover:bg-gray-200 font-bold">B</button>
              <button type="button" onClick={() => insertMd('*', '*')} className="text-xs px-2 py-1 rounded hover:bg-gray-200 italic">I</button>
              <button type="button" onClick={() => insertMd('\n## ', '')} className="text-xs px-2 py-1 rounded hover:bg-gray-200">H2</button>
              <button type="button" onClick={() => insertMd('\n### ', '')} className="text-xs px-2 py-1 rounded hover:bg-gray-200">H3</button>
              <button type="button" onClick={() => insertMd('\n- ', '')} className="text-xs px-2 py-1 rounded hover:bg-gray-200">リスト</button>
              <button type="button" onClick={() => insertMd('[', '](url)')} className="text-xs px-2 py-1 rounded hover:bg-gray-200">リンク</button>
              <button type="button" onClick={() => setShowPreview(!showPreview)} className={`text-xs px-2 py-1 rounded ml-auto ${showPreview ? 'bg-sky-100 text-sky-700' : 'hover:bg-gray-200'}`}>
                {showPreview ? '編集' : 'プレビュー'}
              </button>
            </div>
            {showPreview ? (
              <div className="p-4 min-h-[300px] prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: simpleMarkdown(content) }} />
            ) : (
              <textarea
                id="blog-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full border-0 p-4 focus:ring-0 focus:outline-none resize-y min-h-[300px] font-mono text-sm"
                rows={14}
                maxLength={50000}
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="publish" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
          <label htmlFor="publish" className="text-sm">公開する</label>
        </div>

        {/* 破壊操作(削除)は左端に離し、主動線(戻る・保存する)を右にまとめる。
            削除を右下から外すことで、右下固定のAIサポートウィジェットとの被りも解消する。 */}
        <div className="flex items-center gap-3 pt-4">
          <button type="button" onClick={handleDelete} className="text-sm text-red-500 hover:underline">
            削除
          </button>
          <button type="button" onClick={() => router.push('/admin/blog')} className="ml-auto text-sm text-gray-500 hover:underline">
            戻る
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-primary !py-3 !px-8">
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmDialog
        open={confirmDelete}
        title="記事を削除"
        message="この記事を削除しますか？"
        confirmLabel="削除する"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
