'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

function simpleMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-sky-600 underline">$1</a>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

export default function NewBlogPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
          <label htmlFor="blog-title" className="form-label">タイトル <span className="text-red-500">*</span></label>
          <input id="blog-title" value={title} onChange={(e) => setTitle(e.target.value)} className="form-input" />
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
