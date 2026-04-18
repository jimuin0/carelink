'use client';

import { useState, useEffect, useCallback } from 'react';
import Toast from '@/components/Toast';

type Reply = {
  id: string;
  body: string;
  created_at: string;
  profiles?: { display_name: string | null } | null;
};

type Post = {
  id: string;
  category: string;
  title: string;
  body: string;
  is_pinned: boolean;
  is_locked: boolean;
  reply_count: number;
  like_count: number;
  view_count: number;
  last_reply_at: string | null;
  created_at: string;
  profiles?: { display_name: string | null } | null;
};

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  general: { label: '一般', color: 'bg-gray-100 text-gray-700' },
  question: { label: '質問', color: 'bg-blue-100 text-blue-700' },
  tips: { label: 'Tips', color: 'bg-green-100 text-green-700' },
  showcase: { label: '事例紹介', color: 'bg-purple-100 text-purple-700' },
  announcement: { label: 'お知らせ', color: 'bg-orange-100 text-orange-700' },
};

function PostDetail({ post, onLike, onReply }: {
  post: Post;
  onLike: (postId: string, liked: boolean) => void;
  onReply: (postId: string, reply: Reply) => void;
}) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(true);
  const [replyBody, setReplyBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [likePending, setLikePending] = useState(false);

  useEffect(() => {
    setLoadingReplies(true);
    fetch(`/api/admin/community/posts/${post.id}/replies`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setReplies(d.replies || []); setLoadingReplies(false); })
      .catch(() => setLoadingReplies(false));
  }, [post.id]);

  const handleLike = useCallback(async () => {
    if (likePending) return;
    setLikePending(true);
    const method = liked ? 'DELETE' : 'POST';
    try {
      const res = await fetch(`/api/admin/community/posts/${post.id}/likes`, { method });
      if (res.ok || res.status === 409) {
        const newLiked = !liked;
        const newCount = newLiked ? likeCount + 1 : likeCount - 1;
        setLiked(newLiked);
        setLikeCount(newCount);
        onLike(post.id, newLiked);
      }
    } finally {
      setLikePending(false);
    }
  }, [liked, likeCount, likePending, post.id, onLike]);

  const handleReply = async () => {
    if (!replyBody.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/community/posts/${post.id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyBody }),
      });
      if (res.ok) {
        const data = await res.json();
        setReplies((prev) => [...prev, data.reply]);
        setReplyBody('');
        onReply(post.id, data.reply);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4 border-t pt-4 space-y-4">
      <p className="text-sm text-gray-700 whitespace-pre-wrap">{post.body}</p>

      {/* Like button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleLike}
          disabled={likePending}
          className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition-colors ${
            liked
              ? 'bg-sky-50 border-sky-300 text-sky-600 font-medium'
              : 'border-gray-200 text-gray-500 hover:border-sky-200 hover:text-sky-500'
          } disabled:opacity-50`}
        >
          👍 <span>{likeCount}</span>
        </button>
      </div>

      {/* Replies */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">返信 {replies.length}件</h4>
        {loadingReplies ? (
          <p className="text-xs text-gray-400">読み込み中...</p>
        ) : replies.length === 0 ? (
          <p className="text-xs text-gray-400">まだ返信がありません</p>
        ) : (
          replies.map((r) => (
            <div key={r.id} className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.body}</p>
              <p className="text-xs text-gray-400 mt-1">
                {r.profiles?.display_name ?? '匿名'} · {new Date(r.created_at).toLocaleDateString('ja-JP')}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Reply form */}
      {!post.is_locked && (
        <div className="flex gap-2">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="返信を入力..."
            rows={2}
            maxLength={2000}
            className="flex-1 border rounded-lg px-3 py-2 text-sm resize-none"
          />
          <button
            type="button"
            onClick={handleReply}
            disabled={submitting || !replyBody.trim()}
            className="self-end bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-600 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {submitting ? '送信中...' : '返信する'}
          </button>
        </div>
      )}
      {post.is_locked && (
        <p className="text-xs text-gray-400">🔒 このスレッドはロックされています</p>
      )}
    </div>
  );
}

export default function CommunityPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [form, setForm] = useState({ category: 'general', title: '', body: '' });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetch('/api/admin/community/posts')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setPosts(d.posts || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!form.title || !form.body) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const data = await res.json();
        setPosts((prev) => [data.post, ...prev]);
        setShowCreate(false);
        setForm({ category: 'general', title: '', body: '' });
      } else {
        const e = await res.json().catch(() => null);
        setToast({ type: 'error', message: e?.error ?? '投稿に失敗しました' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleLike = useCallback((postId: string, liked: boolean) => {
    setPosts((prev) => prev.map((p) =>
      p.id === postId ? { ...p, like_count: p.like_count + (liked ? 1 : -1) } : p
    ));
  }, []);

  const handleReply = useCallback((postId: string, _reply: Reply) => {
    setPosts((prev) => prev.map((p) =>
      p.id === postId ? { ...p, reply_count: p.reply_count + 1 } : p
    ));
  }, []);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">オーナーコミュニティ</h1>
          <p className="text-sm text-gray-500 mt-1">施設オーナー同士の交流・情報共有の場です</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-600 transition-colors"
        >
          投稿する
        </button>
      </div>

      {/* Welcome banner */}
      <div className="bg-gradient-to-r from-sky-50 to-indigo-50 rounded-xl p-6 border border-sky-100">
        <h2 className="font-semibold text-sky-800">コミュニティへようこそ</h2>
        <p className="text-sm text-sky-700 mt-1">
          同じ施設オーナーとして、経験やノウハウを共有しましょう。質問・Tips・事例紹介など、お気軽に投稿してください。
        </p>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">新規投稿</h2>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">カテゴリー</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(CATEGORY_LABELS).map(([value, { label, color }]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, category: value }))}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                    form.category === value ? color + ' font-bold ring-2 ring-offset-1 ring-sky-400' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">タイトル <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="例: 予約率を上げるために実践していること"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              maxLength={200}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">本文 <span className="text-red-500">*</span></label>
            <textarea
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder="詳細を書いてください..."
              rows={6}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              maxLength={5000}
            />
            <div className="text-right text-xs text-gray-400 mt-0.5">{form.body.length}/5000</div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCreate}
              disabled={submitting || !form.title || !form.body}
              className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-600 disabled:opacity-50 transition-colors"
            >
              {submitting ? '投稿中...' : '投稿する'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* Post list */}
      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-400">読み込み中...</div>
      ) : posts.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <div className="text-4xl mb-4">💬</div>
          <p className="text-gray-700 font-medium">まだ投稿がありません</p>
          <p className="text-sm text-gray-500 mt-1">最初の投稿をしてみましょう！</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div
              key={post.id}
              className={`bg-white rounded-xl border p-5 hover:border-sky-200 transition-colors ${
                selectedPost?.id === post.id ? 'border-sky-300 bg-sky-50/30' : ''
              }`}
            >
              <div
                className="cursor-pointer"
                onClick={() => setSelectedPost(selectedPost?.id === post.id ? null : post)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {post.is_pinned && <span className="text-xs">📌</span>}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_LABELS[post.category]?.color || 'bg-gray-100'}`}>
                        {CATEGORY_LABELS[post.category]?.label || post.category}
                      </span>
                    </div>
                    <h3 className="font-semibold text-gray-900 mt-1 truncate">{post.title}</h3>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span>{new Date(post.created_at).toLocaleDateString('ja-JP')}</span>
                      <span>👍 {post.like_count}</span>
                      <span>💬 {post.reply_count}</span>
                      <span>👁 {post.view_count}</span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 mt-1 shrink-0">
                    {selectedPost?.id === post.id ? '▲' : '▼'}
                  </span>
                </div>
              </div>

              {selectedPost?.id === post.id && (
                <PostDetail
                  post={post}
                  onLike={handleLike}
                  onReply={handleReply}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
