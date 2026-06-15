'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Toast from '@/components/Toast';

const SECTION_TEMPLATES = {
  paragraph: '{"type":"paragraph","text":"テキストをここに入力"}',
  heading: '{"type":"heading","heading":"見出しテキスト"}',
  list: '{"type":"list","items":["項目1","項目2","項目3"]}',
  callout_tip: '{"type":"callout","calloutType":"tip","text":"ヒント内容"}',
  callout_info: '{"type":"callout","calloutType":"info","text":"情報内容"}',
  callout_warning: '{"type":"callout","calloutType":"warning","text":"注意内容"}',
};

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s　]+/g, '-')
    .replace(/[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf-]/g, '')
    .replace(/^-|-$/g, '') || `post-${Date.now()}`;
}

export default function NewPlatformBlogPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [readingTime, setReadingTime] = useState(5);
  const [contentJson, setContentJson] = useState('[]');
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jsonError, setJsonError] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleTitleBlur = () => {
    if (!slug) setSlug(generateSlug(title));
  };

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

    const res = await fetch('/api/admin/platform-blog', {
      method: 'POST',
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
      setToast({ type: 'error', message: e.error || '作成に失敗しました' });
    } else {
      router.push('/admin/platform-blog');
    }
    setSaving(false);
  };

  return (
    <div className="max-w-3xl space-y-5">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">新規コラム記事</h1>
        <button type="button" onClick={() => router.push('/admin/platform-blog')} className="text-sm text-gray-500 hover:underline">
          ← 一覧に戻る
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">タイトル <span className="text-red-500">*</span></label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            placeholder="初めての鍼灸院ガイド"
            maxLength={200}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">スラッグ（URL） <span className="text-red-500">*</span></label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400"
            placeholder="beginner-acupuncture-guide"
            maxLength={200}
          />
          <p className="text-xs text-gray-400 mt-1">/blog/{slug || '(スラッグ)'}</p>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">概要文</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            placeholder="記事の概要（検索結果のdescriptionに使用）"
            maxLength={500}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">カテゴリ</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="category-options"
              maxLength={50}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="美容ガイド"
            />
            <datalist id="category-options">
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
              min={1}
              max={60}
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
            placeholder="鍼灸, 初めて, 効果"
            maxLength={200}
          />
        </div>
      </div>

      {/* コンテンツ編集 */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">本文コンテンツ（JSON配列）</label>
          <span className="text-xs text-gray-400">sections: {(() => { try { return JSON.parse(contentJson).length; } catch { return '?'; } })()}</span>
        </div>

        {/* セクション追加ボタン */}
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
          rows={14}
          className={`w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-400 ${jsonError ? 'border-red-400' : 'border-gray-300'}`}
          spellCheck={false}
        />
        {jsonError && <p role="alert" className="text-xs text-red-500">{jsonError}</p>}
        <p className="text-xs text-gray-400">
          各セクションの type: paragraph / heading / list / callout（calloutType: tip|info|warning）
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="text-sm">公開する（チェックなし = 下書き保存）</span>
        </label>
      </div>

      <div className="flex gap-3">
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
          className="flex-1 px-4 py-2.5 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 font-medium disabled:opacity-50"
        >
          {saving ? '保存中...' : isPublished ? '公開して保存' : '下書き保存'}
        </button>
      </div>
    </div>
  );
}
