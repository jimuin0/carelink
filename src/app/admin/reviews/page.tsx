'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { SbPageHeader } from '@/components/admin/SbUi';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import type { AdminReview, AdminReviewFilter } from '@/lib/admin-review-list';
import FacilitySelector, { loadAdminFacilitySelection, type AdminFacilityChoice } from '@/components/admin/FacilitySelector';
import { REVIEW_REPLY_MAX_LENGTH } from '@/lib/review-reply-limits';

// review_replies.created_at は DB 定義上 NOT NULL ではない（DEFAULT now() のみ、
// supabase/migrations/20260323000005_phase6_advanced.sql）ため string | null として扱う。
type ReviewReply = { id: string; content: string; created_at: string | null };

type ReplyApiResult = { ok: true; body: unknown } | { ok: false; status: number; message: string };

// 編集中の返信。replyId は編集を始めたときの返信（読み直しで別の返信に置き換わったら編集をやめる）。
type EditingReply = { reviewId: string; replyId: string; text: string };

/**
 * 返信の書き込みはすべて /api/admin/review-replies を通す（2026年10月22日）。
 * 以前はブラウザから review_replies へ直接 INSERT しており、投稿後は編集も削除もできなかった。
 * 権限・口コミの所属・文字数は API と DB（RPC）が書き込みと同時に確かめる。
 */
async function callReplyApi(url: string, init: RequestInit, fallback: string): Promise<ReplyApiResult> {
  try {
    const res = await fetch(url, init);
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, body };
    const error = body !== null && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
    return { ok: false, status: res.status, message: typeof error === 'string' && error ? error : fallback };
  } catch {
    return { ok: false, status: 0, message: fallback };
  }
}

/** API 応答の reply を画面用の形に。形が違えば null（呼び出し側で再読み込みする）。 */
function replyFromBody(body: unknown): ReviewReply | null {
  const reply = body !== null && typeof body === 'object' ? (body as { reply?: unknown }).reply : undefined;
  if (reply === null || typeof reply !== 'object') return null;
  const { id, content, created_at: createdAt } = reply as Record<string, unknown>;
  if (typeof id !== 'string' || typeof content !== 'string') return null;
  return { id, content, created_at: typeof createdAt === 'string' ? createdAt : null };
}

/**
 * 口コミ一覧を /api/admin/reviews から読む（2026年10月23日）。以前はブラウザから select('*') で読んでおり、
 * 画面に出さない投稿者の IP アドレスとアカウント ID まで店舗のブラウザに届いていた。
 * API は画面に出す列と運営の審査状態だけを返す。読めない・形が違うときは null。
 */
async function fetchReviews(facilityId: string, filter: AdminReviewFilter): Promise<AdminReview[] | null> {
  try {
    const res = await fetch(`/api/admin/reviews?facility_id=${encodeURIComponent(facilityId)}&filter=${filter}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json().catch(() => null);
    const list = body !== null && typeof body === 'object' ? (body as { reviews?: unknown }).reviews : undefined;
    return Array.isArray(list) ? (list as AdminReview[]) : null;
  } catch {
    return null;
  }
}

// 運営の審査で止められている口コミの表示。公開ページと評価には is_flagged=false の口コミしか出ないので、
// status（公開／非表示）だけで『公開中』と出すと実態と食い違う（2026年10月23日）。
const MODERATION_NOTICE = {
  pending: { badge: '運営の確認中', text: '運営が内容を確認しています。確認が終わるまで店舗ページと評価には反映されません。' },
  rejected: { badge: '運営判断で非公開', text: '運営の判断で非公開になっています。店舗から公開することはできません。' },
  // 承認済みなのに旗が戻ったまま止まっている（運営の審査画面にも出ない）。『確認中』とは案内しない。
  stalled: { badge: '公開手続きの停止', text: '運営の確認は済んでいますが、公開の手続きが止まっています。お手数ですが、運営までお問い合わせください。' },
} as const;

function AdminReviewsContent() {
  // 複数店舗のオーナーは ?facility_id= で店舗を選ぶ（2026年10月22日）。以前は facility_members を
  // .limit(1).single() で 1 行だけ読み、どの店舗の口コミが出るかが行の並び次第だった
  // （通知から開いても別の店舗の口コミが表示され得た）。
  const requestedFacility = useSearchParams().get('facility_id');
  const [facilityChoices, setFacilityChoices] = useState<AdminFacilityChoice[]>([]);
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [filter, setFilter] = useState<AdminReviewFilter>('all');
  const [updating, setUpdating] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  // 返信の公開・編集・削除の実行中の口コミ ID（二重送信を防ぐ）
  const [replyBusy, setReplyBusy] = useState<string | null>(null);
  // review_replies は UNIQUE(review_id)＝1 口コミにつき返信は 1 件。口コミ ID → 返信。
  const [replies, setReplies] = useState<Record<string, ReviewReply>>({});
  const [editing, setEditing] = useState<EditingReply | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadReviews = useCallback(async (fId: string) => {
    setLoadError(false);
    const list = await fetchReviews(fId, filter);
    if (!list) { setLoadError(true); return [] as AdminReview[]; }
    setReviews(list);
    return list;
  }, [filter]);

  // React Compiler の set-state-in-effect 対策：user→membership→facilityId→口コミ＋返信取得の
  // 全工程を useCallback 関数として effect の依存に置き外部から直接呼ぶのではなく、effect 内に
  // inline した非同期IIFEとして定義する（React 公式が推奨する形）。リトライ時も facilityId を
  // 再導出する必要があるため引き続き全工程をここに集約し、リトライは reloadKey のインクリメント
  // で effect を再発火させる形に統一する（取得ロジックの二重定義を避ける）。依存配列は元の
  // reload の依存（[loadReviews]）と同じ反応性を保つため loadReviews を含める（filter 変更で
  // loadReviews の identity が変われば、従来どおりこの effect も再実行される）。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    (async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      // 店舗が 1 つなら自動で選ばれ、複数なら明示の選択が要る（勝手に 1 店舗を選ばない）。
      // 自分の店舗でない facility_id は例外になり、下の catch で読み込み失敗として表示する。
      const selection = await loadAdminFacilitySelection(supabase, user.id, requestedFacility);
      setFacilityChoices(selection.choices);
      if (!selection.selectedId) { setLoading(false); return; }
      setFacilityId(selection.selectedId);
      const loaded = await loadReviews(selection.selectedId);
      // 返信は補助情報（無ければ非表示）。主表示の口コミは loadReviews 側で error 処理済みのため
      // ここでの失敗は致命的でなく、取得できた分のみ表示する。
      // review_replies に facility_id 列は無いため、当施設の口コミ ID 群で review_id を絞る。
      const reviewIds = loaded.map((r) => r.id);
      const { data: rows } = reviewIds.length
        ? await supabase
            .from('review_replies')
            .select('id, review_id, content, created_at')
            .in('review_id', reviewIds)
            .order('created_at')
        : { data: [] as { id: string; review_id: string; content: string; created_at: string | null }[] };
      if (rows) {
        const map: Record<string, ReviewReply> = {};
        for (const r of rows) {
          if (!map[r.review_id]) map[r.review_id] = { id: r.id, content: r.content, created_at: r.created_at };
        }
        const shown = new Set(reviewIds);
        setReplies(map);
        // 読み直した結果、編集中の返信が消えていた・別の返信に置き換わっていた（他の管理者が先に
        // 削除した・削除して投稿し直した）ときは編集をやめる。残すと編集欄は出ないのに他の「編集」が
        // 押せないままになり、新しい返信を古い本文で上書きできてしまう。
        // 絞り込みで今は表示していない口コミの編集は、状態が分からないので残す。
        setEditing((prev) => (prev && shown.has(prev.reviewId) && map[prev.reviewId]?.id !== prev.replyId ? null : prev));
        // 返信が付いた口コミの書きかけ（他の管理者が先に返信した 409 など）は入力欄ごと消えるので捨てる。
        // 残すと見えない「未保存の変更」になり、その返信が後で消えたときに古い下書きが戻ってくる。
        setReplyText((prev) => {
          const answered = Object.keys(prev).filter((id) => map[id]);
          if (answered.length === 0) return prev;
          const next = { ...prev };
          for (const id of answered) delete next[id];
          return next;
        });
      }
      setLoading(false);
    })().catch(() => { setLoadError(true); setLoading(false); });
  }, [loadReviews, reloadKey, requestedFacility]);

  // 監査P13: この effect は filter 変更時の再取得用。従来は reload() が facilityId を
  // セットした初回にも発火し、reload 内の loadReviews と合わせて初回に2回フェッチしていた。
  // 初回（facilityId 確定＝reload が取得済み）の1回はスキップし、以降の filter 変更時のみ再取得する。
  const filterEffectInitialized = useRef(false);
  useEffect(() => {
    if (!facilityId) return;
    if (!filterEffectInitialized.current) { filterEffectInitialized.current = true; return; }
    loadReviews(facilityId);
  }, [filter, facilityId, loadReviews]);

  const toggleStatus = async (review: AdminReview) => {
    if (!facilityId || updating) return;
    const newStatus = review.status === 'published' ? 'hidden' : 'published';
    // 運営の審査で止められている口コミは、店舗が公開に切り替えても公開されない（ボタンも押せない）。
    if (newStatus === 'published' && review.moderation !== 'none') return;
    setUpdating(review.id);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase
        .from('facility_reviews')
        .update({ status: newStatus })
        .eq('id', review.id)
        .eq('facility_id', facilityId);
      if (error) throw error;
      // 公開に切り替えたときは、その間に運営の審査が始まっていないかを読み直して確かめる
      // （読み直せないときは切り替えた結果だけを反映し、一覧はそのまま残す）。
      const reloaded = newStatus === 'published' ? await fetchReviews(facilityId, filter) : null;
      const current = reloaded?.find((r) => r.id === review.id);
      if (reloaded) setReviews(reloaded);
      else setReviews((prev) => prev.map((r) => r.id === review.id ? { ...r, status: newStatus } : r));
      setToast(current && current.moderation !== 'none'
        ? { type: 'success', message: '公開に切り替えましたが、運営の確認が終わるまで店舗ページには表示されません' }
        : { type: 'success', message: newStatus === 'published' ? '公開しました' : '非表示にしました' });
    } catch {
      setToast({ type: 'error', message: '更新に失敗しました' });
    } finally {
      setUpdating(null);
    }
  };

  if (loading) return <AdminPageLoading />;
  if (loadError && !facilityId) return <LoadError onRetry={() => setReloadKey((k) => k + 1)} message="管理する店舗の確認に失敗しました" />;
  if (!facilityId) {
    return (
      <div>
        <SbPageHeader title="口コミ管理" />
        <FacilitySelector choices={facilityChoices} selectedId={null} path="/admin/reviews" />
      </div>
    );
  }

  const replyUrl = (suffix = '') => `/api/admin/review-replies${suffix}?facility_id=${encodeURIComponent(facilityId)}`;

  // 失敗したら理由を出す。他の管理者が先に返信した（409）・既に消えていた（404）ときは、
  // 画面を今の状態に合わせるために読み直す（消えた返信の編集・返信済みの書きかけは読み直しで片付く）。
  const reportFailure = (result: { status: number; message: string }) => {
    setToast({ type: 'error', message: result.message });
    if (result.status === 404 || result.status === 409) setReloadKey((k) => k + 1);
  };

  const publishReply = async (reviewId: string) => {
    const text = replyText[reviewId]?.trim();
    setConfirmPublish(null);
    if (!text || replyBusy) return;
    setReplyBusy(reviewId);
    const result = await callReplyApi(replyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_id: reviewId, content: text }),
    }, '返信を公開できませんでした');
    if (result.ok) {
      const reply = replyFromBody(result.body);
      if (reply) setReplies((prev) => ({ ...prev, [reviewId]: reply }));
      else setReloadKey((k) => k + 1);
      setReplyText((prev) => ({ ...prev, [reviewId]: '' }));
      setToast({ type: 'success', message: '返信を公開しました' });
    } else {
      reportFailure(result);
    }
    setReplyBusy(null);
  };

  const saveEdit = async () => {
    if (!editing || replyBusy) return;
    const current = replies[editing.reviewId];
    const text = editing.text.trim();
    if (!current || current.id !== editing.replyId || !text || text === current.content) return;
    const { reviewId } = editing;
    setReplyBusy(reviewId);
    const result = await callReplyApi(replyUrl(`/${encodeURIComponent(current.id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    }, '返信を更新できませんでした');
    if (result.ok) {
      const reply = replyFromBody(result.body);
      if (reply) setReplies((prev) => ({ ...prev, [reviewId]: reply }));
      else setReloadKey((k) => k + 1);
      setEditing(null);
      setToast({ type: 'success', message: '返信を更新しました' });
    } else {
      reportFailure(result);
    }
    setReplyBusy(null);
  };

  const deleteReply = async () => {
    const reviewId = confirmDelete;
    // 確定した時点で確認を閉じる。送信中に開いたままだと「キャンセル」が押せるのに削除は止まらず、
    // ボタンの意味と結果が食い違う（公開の確認と同じ扱い）。
    setConfirmDelete(null);
    const current = reviewId ? replies[reviewId] : undefined;
    if (!reviewId || !current || replyBusy) return;
    setReplyBusy(reviewId);
    const result = await callReplyApi(replyUrl(`/${encodeURIComponent(current.id)}`), { method: 'DELETE' },
      '返信を削除できませんでした');
    if (result.ok) {
      setReplies((prev) => {
        const next = { ...prev };
        delete next[reviewId];
        return next;
      });
      if (editing?.reviewId === reviewId) setEditing(null);
      setToast({ type: 'success', message: '返信を削除しました' });
    } else {
      reportFailure(result);
    }
    setReplyBusy(null);
  };

  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const editingDirty = editing !== null && editing.text.trim() !== (replies[editing.reviewId]?.content ?? '');

  return (
    <div>
      <FacilitySelector choices={facilityChoices} selectedId={facilityId} path="/admin/reviews" busy={updating !== null || replyBusy !== null}
        dirty={editingDirty || Object.values(replyText).some((t) => t.trim() !== '')} />
      <SbPageHeader title="口コミ管理" />

      {/* フィルタ */}
      <div className="flex flex-wrap gap-2 mb-6">
        {([['all', 'すべて'], ['published', '公開中'], ['hidden', '非表示'], ['moderation', '運営の確認']] as const).map(([value, label]) => (
          <button
            type="button"
            key={value}
            onClick={() => setFilter(value)}
            className={`text-sm px-4 py-2 rounded-full font-bold transition-colors ${
              filter === value ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loadError ? (
        <LoadError onRetry={() => setReloadKey((k) => k + 1)} message="口コミの読み込みに失敗しました" />
      ) : reviews.length === 0 ? (
        <div className="bg-white rounded-xl shadow-xs p-12 text-center">
          <p className="text-gray-500">口コミがありません</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => {
            const reply = replies[review.id];
            const isEditing = editing?.reviewId === review.id;
            const busy = replyBusy === review.id;
            const notice = review.moderation === 'none' ? null : MODERATION_NOTICE[review.moderation];
            // 店舗ページに実際に出ているか（公開設定で、運営の審査で止められていない）。
            const visible = review.status === 'published' && notice === null;
            // 運営の審査で止められている口コミは、店舗の操作では公開できない（非表示にはできる）。
            const publishBlocked = review.status === 'hidden' && notice !== null;
            const noticeId = `review-moderation-${review.id}`;
            return (
              // 店舗ページに出ていない口コミは不透明度ではなく地色と破線で示す。opacity は中の文字・ボタン
              // （返信の編集・削除・保存など）のコントラストまで落とし、AA を割るため使わない。
              <article key={review.id} aria-label={`${review.reviewer_name}さんの口コミ`}
                className={`rounded-xl shadow-xs p-5 ${visible ? 'bg-white' : 'bg-gray-50 border border-dashed border-gray-300'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
                      <span className="text-amber-400 text-sm">{stars(review.rating)}</span>
                      <span className="text-sm font-bold text-gray-700">{review.rating.toFixed(1)}</span>
                      {notice ? (
                        <span className={`text-micro px-2 py-0.5 rounded-full font-bold ${
                          review.moderation === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {notice.badge}
                        </span>
                      ) : (
                        <span className={`text-micro px-2 py-0.5 rounded-full font-bold ${
                          visible ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {visible ? '公開中' : '非表示'}
                        </span>
                      )}
                      {notice && review.status === 'hidden' && review.moderation !== 'rejected' && (
                        <span className="text-micro px-2 py-0.5 rounded-full font-bold bg-gray-100 text-gray-600">非表示</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-800">{review.reviewer_name}</p>
                    {review.comment && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-3">{review.comment}</p>
                    )}
                    {notice && <p id={noticeId} className="text-xs text-gray-700 mt-2">{notice.text}</p>}
                    <p className="text-xs text-gray-500 mt-2">{review.created_at ? new Date(review.created_at).toLocaleDateString('ja-JP') : ''}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleStatus(review)}
                    disabled={updating === review.id || publishBlocked}
                    aria-describedby={publishBlocked ? noticeId : undefined}
                    className={`shrink-0 text-xs px-4 py-2 rounded-lg font-bold transition-colors disabled:cursor-not-allowed ${
                      review.status === 'published'
                        ? 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600'
                        : publishBlocked ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-700 hover:bg-green-100'
                    }`}
                  >
                    {review.status === 'published' ? '非表示にする' : '公開する'}
                  </button>
                </div>

                {reply && !isEditing && (
                  <div className="mt-3 ml-4 bg-sky-50 border border-sky-100 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-micro font-bold text-sky-700">サロンより</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing({ reviewId: review.id, replyId: reply.id, text: reply.content })}
                          disabled={replyBusy !== null || editing !== null}
                          className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 bg-white font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(review.id)}
                          disabled={replyBusy !== null}
                          className="text-xs px-3 py-1.5 rounded-lg border border-red-200 bg-white font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">{reply.content}</p>
                    {/* created_at が null の行は new Date(null)＝1970/1/1 の誤表示を避けて日付を出さない */}
                    <p className="text-xs text-gray-500 mt-1">{reply.created_at ? new Date(reply.created_at).toLocaleDateString('ja-JP') : ''}</p>
                  </div>
                )}

                {reply && isEditing && (
                  <div className="mt-3 ml-4">
                    <label htmlFor={`reply-edit-${review.id}`} className="text-xs font-bold text-gray-700">返信を編集</label>
                    <textarea
                      id={`reply-edit-${review.id}`}
                      value={editing.text}
                      onChange={(e) => setEditing({ reviewId: review.id, replyId: reply.id, text: e.target.value })}
                      maxLength={REVIEW_REPLY_MAX_LENGTH}
                      rows={3}
                      className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-sky-300"
                    />
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500">{editing.text.length}/{REVIEW_REPLY_MAX_LENGTH}</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          disabled={busy}
                          className="text-xs px-4 py-2 rounded-lg border border-gray-300 bg-white font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          キャンセル
                        </button>
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={busy || !editing.text.trim() || editing.text.trim() === reply.content}
                          className="btn-primary shrink-0 text-xs px-4! py-2!"
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {!reply && (
                  <div className="mt-3">
                    <label htmlFor={`reply-new-${review.id}`} className="sr-only">口コミへの返信</label>
                    <textarea
                      id={`reply-new-${review.id}`}
                      placeholder="口コミに返信する..."
                      value={replyText[review.id] || ''}
                      onChange={(e) => setReplyText((prev) => ({ ...prev, [review.id]: e.target.value }))}
                      maxLength={REVIEW_REPLY_MAX_LENGTH}
                      rows={2}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-sky-300"
                    />
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500">{(replyText[review.id] || '').length}/{REVIEW_REPLY_MAX_LENGTH}</span>
                      <button
                        type="button"
                        onClick={() => setConfirmPublish(review.id)}
                        disabled={busy || !(replyText[review.id]?.trim())}
                        className="btn-primary shrink-0 text-xs px-4! py-2!"
                      >
                        返信
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmPublish !== null}
        title="返信を公開"
        message="返信は店舗ページに公開されます。"
        confirmLabel="公開する"
        confirmDisabled={replyBusy !== null}
        onConfirm={() => { if (confirmPublish) void publishReply(confirmPublish); }}
        onCancel={() => setConfirmPublish(null)}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        title="返信を削除"
        message="この返信を削除しますか？店舗ページからも消えます。"
        confirmLabel="削除する"
        variant="danger"
        confirmDisabled={replyBusy !== null}
        onConfirm={() => { void deleteReply(); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}

// 店舗を切り替えたら中身を作り直し、前の店舗の口コミや入力中の返信が残らないようにする。
function ReviewsSelectionRoute() {
  const requested = useSearchParams().get('facility_id');
  return <AdminReviewsContent key={requested ?? 'unselected'} />;
}

export default function AdminReviewsPage() {
  return <Suspense fallback={<AdminPageLoading />}><ReviewsSelectionRoute /></Suspense>;
}
