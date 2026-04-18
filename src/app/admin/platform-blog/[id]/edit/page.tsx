'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

const SECTION_TEMPLATES = {
  paragraph: '{"type":"paragraph","text":"テキストをここに入力"}',
  heading: '{"type":"heading","heading":"見出しテキスト"}',
  list: '{"type":"list","items":["項目1","項目2","項目3"]}',
  callout_tip: '{"type":"callout","calloutType":"tip","text":"ヒント内容"}',
  callout_info: '{"type":"callout","calloutType":"info","text":"情報内容"}',
  callout_warning: '{"type":"callout","calloutType":"warning","text":"注意内容"}',
};

interface Props { params: { id: string } }

export default function EditPlatformBlogPage({ params }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [readingTime, setReadingTime] = useState(5);
  const [contentJson, setContentJson] = useState('[]');
  const [isPublished, setIsPublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [jsonError, setJsonError] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data } = await supabase
      .from('platform_blog_posts')
      .select('*')
      .eq('id', params.id)
      .single();

    if (data) {
      setTitle(data.title);
      setSlug(data.slug);
      setDescription(data.description || '');
      setCategory(data.category || '');
      setTags((data.tags || []).join(', '));
      setReadingTime(data.reading_time || 5);
      setContentJson(JSON.stringify(data.content, null, 2));
      setIsPublished(data.is_published);
    }
    setLoading(false);
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const validateJson = (value: string) => {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) { setJsonError('配列（[...]）で記述してください'); return false; }
      setJsonError('');
      return true;
    } catch {
      setJsonError('JSON形式が正しくありません');
      return false;
    }
  };

  const insertSection = (template: string) => {
    try {
      const current = JSON.parse(contentJson);
      const newSection = JSON.parse(template);
      setContentJson(JSON.stringify([...current, newSection], null, 2));
      setJsonError('');
    } catch { /* noop */ }
  };

  const handleSave = async () => {
    if (saving || !title || !slug) return;
    if (!validateJson(contentJson)) return;
    setSaving(true);

    const res = await fetch(`/api/admin/platform-blog/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        title,
        description,
        category,
        tags: tags.split(',').map((t: string) => t.trim()).filter(Boolean),
        reading_time: readingTime,
        content: JSON.parse(contentJson),
        is_published: isPublished,
      }),
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setToast({ type: 'error', message: e.error || '保存に失敗しました' });
    } else {
      setToast({ type: 'success', message: '保存しました' });
    }
    setSaving(false);
  };

  const handleDelete = () => {
    setConfirmDelete(true);
  };

  const doDelete = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    await fetch(`/api/admin/platform-blog/${params.id}`, { method: 'DELETE' });
    router.push('/admin/platform-blog');
  };

  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">コラム記事を編集</h1>
        <div className="flex items-center gap-3">
          {isPublished && (
            <a href={`/blog/${slug}`} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-500 hover:text-sky-600">
              表示 →
            </a>
          )}
          <button type="button" onClick={() => router.push('/admin/platform-blog')} className="text-sm text-gray-500 hover:underline">
            ← 一覧
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">タイトル <span className="text-red-500">*</span></label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">スラッグ（URL）</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <p className="text-xs text-gray-400 mt-1">/blog/{slug}</p>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">概要文</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">カテゴリ</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="category-options-edit"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            <datalist id="category-options-edit">
              {['美容ガイド', '健康ガイド', '鍼灸', 'ネイル', 'エステ', '整骨院'].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">読了時間（分）</label>
            <input
              type="number"
              value={readingTime}
              onChange={(e) => setReadingTime(parseInt(e.target.value) || 5)}
              min={1} max={60}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">タグ（カンマ区切り）</label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">本文コンテンツ（JSON配列）</label>
          <span className="text-xs text-gray-400">sections: {(() => { try { return JSON.parse(contentJson).length; } catch { return '?'; } })()}</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-gray-400 self-center">追加:</span>
          {Object.entries(SECTION_TEMPLATES).map(([key, template]) => (
            <button
              key={key}
              type="button"
              onClick={() => insertSection(template)}
              className="text-xs px-2 py-1 bg-gray-100 hover:bg-sky-50 hover:text-sky-700 rounded border border-gray-200 transition-colors"
            >
              {key.replace('_', '/')}
            </button>
          ))}
        </div>

        <textarea
          value={contentJson}
          onChange={(e) => { setContentJson(e.target.value); validateJson(e.target.value); }}
          rows={16}
          className={`w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-400 ${jsonError ? 'border-red-400' : 'border-gray-300'}`}
          spellCheck={false}
        />
        {jsonError && <p role="alert" className="text-xs text-red-500">{jsonError}</p>}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="text-sm">公開する</span>
        </label>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="px-4 py-2.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? '削除中...' : '削除'}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => router.push('/admin/platform-blog')}
          className="px-4 py-2.5 text-sm text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !title || !slug}
          className="px-6 py-2.5 text-sm bg-sky-500 text-white rounded-lg hover:bg-sky-600 font-medium disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="記事を削除"
        message="この記事を削除しますか？元に戻せません。"
        confirmLabel="削除する"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
