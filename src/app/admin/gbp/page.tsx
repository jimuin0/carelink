'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import type { PlaceDetails, GbpAuditResult } from '@/lib/gbp';
import Toast from '@/components/Toast';

type TabId = 'setup' | 'audit' | 'reviews' | 'posts';

interface GbpPost {
  id: string;
  title: string | null;
  body: string;
  post_type: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  photo_url: string | null;
  cta_type: string | null;
  cta_url: string | null;
  created_at: string;
}

const POST_TEMPLATES = [
  {
    label: 'キャンペーン告知',
    title: '【期間限定】〇〇キャンペーン実施中',
    body: '当店では〇月〇日まで、【メニュー名】が通常¥〇〇のところ¥〇〇でご体験いただけます！\nこの機会にぜひお越しください。\n\nご予約はプロフィールのリンクから👇',
  },
  {
    label: 'スタッフ紹介',
    title: 'スタッフ紹介：〇〇担当',
    body: '本日はスタッフの〇〇をご紹介します！\n\n得意なメニュー：〇〇\n資格・経歴：〇〇\n\nお気軽にご指名ください😊',
  },
  {
    label: 'お知らせ（営業日変更など）',
    title: '【お知らせ】〇月の営業予定',
    body: '〇月の営業日についてお知らせします。\n\n・〇月〇日（祝）：通常営業\n・〇月〇日〜〇日：休暇のため休業\n\nご不便をおかけしますが、よろしくお願いいたします。',
  },
  {
    label: 'ビフォーアフター',
    title: 'ビフォーアフター：〇〇メニュー',
    body: '本日のお客様のビフォーアフターをご紹介します✨\n\n施術：〇〇\n所要時間：〇〇分\n\n気になる方はお気軽にご相談ください！\nプロフィールのリンクからご予約できます👇',
  },
];

export default function AdminGbpPage() {
  const [tab, setTab] = useState<TabId>('setup');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Setup
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState('');
  const [gbpCid, setGbpCid] = useState('');
  const [savingSetup, setSavingSetup] = useState(false);

  // Audit
  const [auditData, setAuditData] = useState<{ placeData: PlaceDetails | null; audit: GbpAuditResult } | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  // Posts
  const [posts, setPosts] = useState<GbpPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [showPostForm, setShowPostForm] = useState(false);
  const [newPost, setNewPost] = useState({ title: '', body: '', post_type: 'STANDARD', cta_type: '', cta_url: '' });
  const [savingPost, setSavingPost] = useState(false);

  useEffect(() => {
    const init = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (!membership) { setLoading(false); return; }
      setFacilityId(membership.facility_id);
      const { data: fp } = await supabase.from('facility_profiles').select('gbp_place_id,gbp_cid').eq('id', membership.facility_id).single();
      if (fp) {
        setPlaceId(fp.gbp_place_id ?? '');
        setGbpCid(fp.gbp_cid ?? '');
      }
      setLoading(false);
    };
    init().catch(() => setLoading(false));
  }, []);

  const saveSetup = async () => {
    setSavingSetup(true);
    try {
      const res = await fetch('/api/admin/gbp/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gbp_place_id: placeId, gbp_cid: gbpCid }),
      });
      if (!res.ok) throw new Error();
      setToast({ type: 'success', message: '保存しました' });
    } catch {
      setToast({ type: 'error', message: '保存に失敗しました' });
    } finally {
      setSavingSetup(false);
    }
  };

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await fetch('/api/admin/gbp/place');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAuditData(data);
    } catch {
      setToast({ type: 'error', message: '診断データの取得に失敗しました' });
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const loadPosts = useCallback(async () => {
    setPostsLoading(true);
    try {
      const res = await fetch('/api/admin/gbp/posts');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPosts(data.posts ?? []);
    } catch {
      setToast({ type: 'error', message: '投稿の取得に失敗しました' });
    } finally {
      setPostsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'audit' && !auditData) loadAudit();
    if (tab === 'posts' && posts.length === 0) loadPosts();
  }, [tab, auditData, loadAudit, posts.length, loadPosts]);

  const savePost = async () => {
    if (!newPost.body.trim()) return;
    setSavingPost(true);
    try {
      const res = await fetch('/api/admin/gbp/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPost),
      });
      if (!res.ok) throw new Error();
      setToast({ type: 'success', message: '投稿を保存しました' });
      setShowPostForm(false);
      setNewPost({ title: '', body: '', post_type: 'STANDARD', cta_type: '', cta_url: '' });
      loadPosts();
    } catch {
      setToast({ type: 'error', message: '保存に失敗しました' });
    } finally {
      setSavingPost(false);
    }
  };

  const deletePost = async (id: string) => {
    const res = await fetch(`/api/admin/gbp/posts?id=${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const e = await res.json().catch(() => null);
      setToast({ type: 'error', message: e?.error ?? '操作に失敗しました' });
      return;
    }
    setPosts((prev) => prev.filter((p) => p.id !== id));
    setToast({ type: 'success', message: '削除しました' });
  };

  const markPublished = async (id: string) => {
    const res = await fetch('/api/admin/gbp/posts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'published', published_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => null);
      setToast({ type: 'error', message: e?.error ?? '操作に失敗しました' });
      return;
    }
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, status: 'published', published_at: new Date().toISOString() } : p));
    setToast({ type: 'success', message: 'GBP投稿済みとしてマークしました' });
  };

  if (loading) return <div className="animate-pulse space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}</div>;

  const audit = auditData?.audit;
  const place = auditData?.placeData;

  const categoryItems = audit
    ? Object.entries(
        audit.items.reduce<Record<string, typeof audit.items>>((acc, item) => {
          if (!acc[item.category]) acc[item.category] = [];
          acc[item.category].push(item);
          return acc;
        }, {})
      )
    : [];

  const gbpManageUrl = placeId
    ? `https://business.google.com/dashboard/l/${gbpCid || placeId}`
    : 'https://business.google.com/';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">GBP管理（Googleビジネスプロフィール）</h1>
        {placeId && (
          <a href={gbpManageUrl} target="_blank" rel="noopener noreferrer"
             className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            GBP管理画面を開く ↗
          </a>
        )}
      </div>

      {/* タブ */}
      <div className="flex border-b mb-6 gap-1 flex-wrap">
        {([['setup', 'GBP設定'], ['audit', '診断スコア'], ['reviews', 'Googleクチコミ'], ['posts', 'GBP投稿']] as [TabId, string][]).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === id ? 'border-sky-500 text-sky-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ===== GBP設定 ===== */}
      {tab === 'setup' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-bold mb-1">Google Place ID 連携</h2>
            <p className="text-sm text-gray-500 mb-4">
              Place ID を登録すると、Googleマップのデータを取得して診断スコアとクチコミが表示されます。
            </p>

            <div className="space-y-4 mb-5">
              <div>
                <label className="text-sm font-medium text-gray-700">Place ID</label>
                <p className="text-xs text-gray-400 mb-1">
                  <a href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder" target="_blank" rel="noopener noreferrer" className="text-sky-500 underline">Place ID Finder</a>
                  {' '}で自店舗を検索して取得。「ChIJ...」から始まる文字列。
                </p>
                <input
                  type="text"
                  value={placeId}
                  onChange={(e) => setPlaceId(e.target.value)}
                  placeholder="ChIJxxxxxxxxxxxxxxxxxx"
                  maxLength={300}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">GBP CID（任意）</label>
                <p className="text-xs text-gray-400 mb-1">
                  GBP管理画面のURLに含まれる数字のID（あれば入力）
                </p>
                <input
                  type="text"
                  value={gbpCid}
                  onChange={(e) => setGbpCid(e.target.value)}
                  placeholder="1234567890123456789"
                  maxLength={300}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={saveSetup}
              disabled={savingSetup}
              className="bg-sky-500 text-white text-sm px-6 py-2 rounded-lg hover:bg-sky-600 disabled:opacity-50 transition-colors"
            >
              {savingSetup ? '保存中...' : '保存'}
            </button>
          </div>

          {/* Place ID 取得ガイド */}
          <div className="bg-blue-50 rounded-xl p-5 border border-blue-200">
            <h3 className="text-sm font-bold text-blue-700 mb-3">Place ID の取得手順</h3>
            <ol className="space-y-2 text-sm text-blue-600">
              {[
                '上の「Place ID Finder」リンクを開く',
                '検索ボックスに自店舗名を入力して選択',
                '「Place ID: ChIJ...」の文字列をコピー',
                '上の入力欄に貼り付けて「保存」',
              ].map((step, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-bold shrink-0">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-bold mb-3">GBP最適化チェックリスト（手動確認）</h2>
            <p className="text-sm text-gray-500 mb-4">GBP管理画面で直接確認・設定してください</p>
            <div className="space-y-2">
              {[
                ['プライマリカテゴリ', '業種に最も近いカテゴリを選択（例: まつげパーマ、ネイルサロン）'],
                ['サブカテゴリ', '追加で最大9カテゴリ設定可能'],
                ['Q&Aセクション', '自分で質問・回答を5件以上登録'],
                ['サービス/メニュー登録', 'メニュー名・価格・説明をGBPに登録'],
                ['Google投稿', '週1回の投稿（本ページの「GBP投稿」タブから管理）'],
                ['特別営業時間', '祝日・お盆・年末年始の休業日を登録'],
              ].map(([label, desc]) => (
                <div key={label} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-gray-400">→</span>
                  <div>
                    <p className="text-sm font-medium text-gray-700">{label}</p>
                    <p className="text-xs text-gray-500">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== 診断スコア ===== */}
      {tab === 'audit' && (
        <div className="space-y-5">
          {!placeId && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-700">
              Place ID が未設定です。「GBP設定」タブで登録するとより詳細な診断が可能になります。
            </div>
          )}

          <div className="flex justify-end">
            <button type="button" onClick={loadAudit} disabled={auditLoading}
                    className="text-sm bg-sky-500 text-white px-4 py-2 rounded-lg hover:bg-sky-600 disabled:opacity-50">
              {auditLoading ? '診断中...' : '再診断'}
            </button>
          </div>

          {auditLoading && (
            <div className="animate-pulse space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
            </div>
          )}

          {audit && !auditLoading && (
            <>
              {/* スコアカード */}
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className={`text-5xl font-black ${
                      audit.percentage >= 85 ? 'text-green-500' :
                      audit.percentage >= 70 ? 'text-blue-500' :
                      audit.percentage >= 55 ? 'text-yellow-500' :
                      audit.percentage >= 40 ? 'text-orange-500' : 'text-red-500'
                    }`}>
                      {audit.percentage}
                    </div>
                    <div className="text-xs text-gray-500">/ 100点</div>
                  </div>
                  <div className="flex-1">
                    <div className={`text-lg font-bold mb-1 ${
                      audit.percentage >= 85 ? 'text-green-600' :
                      audit.percentage >= 70 ? 'text-blue-600' :
                      audit.percentage >= 55 ? 'text-yellow-600' :
                      audit.percentage >= 40 ? 'text-orange-600' : 'text-red-600'
                    }`}>
                      {audit.percentage >= 85 ? 'S - 最適化済み' :
                       audit.percentage >= 70 ? 'A - 良好' :
                       audit.percentage >= 55 ? 'B - 改善余地あり' :
                       audit.percentage >= 40 ? 'C - 要改善' : 'D - 緊急改善必要'}
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full transition-all ${
                          audit.percentage >= 85 ? 'bg-green-500' :
                          audit.percentage >= 70 ? 'bg-blue-500' :
                          audit.percentage >= 55 ? 'bg-yellow-500' :
                          audit.percentage >= 40 ? 'bg-orange-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${audit.percentage}%` }}
                      />
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {audit.score}点 / {audit.maxScore}点
                    </div>
                  </div>
                  {place && (
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-bold text-amber-500">★ {place.rating?.toFixed(1) ?? '—'}</div>
                      <div className="text-xs text-gray-500">{(place.user_ratings_total ?? 0).toLocaleString()}件の口コミ</div>
                      <div className="text-xs text-gray-400 mt-0.5">{place.photos?.length ?? 0}枚の写真</div>
                    </div>
                  )}
                </div>
              </div>

              {/* カテゴリ別詳細 */}
              {categoryItems.map(([category, items]) => {
                const catScore = items.reduce((s, i) => s + (i.passed === true ? i.points : 0), 0);
                const catMax = items.reduce((s, i) => s + i.points, 0);
                return (
                  <div key={category} className="bg-white rounded-xl shadow-sm p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold text-gray-700">{category}</h3>
                      <span className="text-sm font-medium text-gray-500">{catScore}/{catMax}点</span>
                    </div>
                    <div className="space-y-2">
                      {items.map((item) => (
                        <div key={item.id} className={`flex items-start gap-3 p-3 rounded-lg ${
                          item.passed === true ? 'bg-green-50' :
                          item.passed === false ? 'bg-red-50' : 'bg-gray-50'
                        }`}>
                          <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                            item.passed === true ? 'bg-green-500 text-white' :
                            item.passed === false ? 'bg-red-400 text-white' : 'bg-gray-300 text-gray-500'
                          }`}>
                            {item.passed === true ? '✓' : item.passed === false ? '✗' : '?'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`text-sm font-medium ${
                                item.passed === true ? 'text-green-800' :
                                item.passed === false ? 'text-red-700' : 'text-gray-600'
                              }`}>{item.label}</p>
                              <span className="text-xs text-gray-400 shrink-0">+{item.points}点</span>
                            </div>
                            {item.detail && (
                              <p className="text-xs text-gray-500 mt-0.5">{item.detail}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ===== Googleクチコミ ===== */}
      {tab === 'reviews' && (
        <div className="space-y-5">
          {!placeId ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 text-center">
              <p className="text-yellow-700 font-medium mb-2">Place ID が未設定です</p>
              <p className="text-sm text-yellow-600">「GBP設定」タブでPlace IDを登録すると、Googleのクチコミをここでまとめてチェックできます。</p>
            </div>
          ) : (
            <>
              {/* GoogleクチコミとCareLink口コミの比較 */}
              {place && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl shadow-sm p-4">
                    <p className="text-xs text-gray-500 mb-1">Googleマップ</p>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-amber-500">★ {place.rating?.toFixed(1)}</span>
                      <span className="text-sm text-gray-500">({place.user_ratings_total}件)</span>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm p-4">
                    <p className="text-xs text-gray-500 mb-1">Googleクチコミ取得数</p>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-gray-700">{place.reviews?.length ?? 0}</span>
                      <span className="text-sm text-gray-500">件（最新5件）</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Googleクチコミ一覧 */}
              {auditLoading ? (
                <div className="animate-pulse space-y-3">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
                </div>
              ) : place?.reviews && place.reviews.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold">最新のGoogleクチコミ</h2>
                    <button type="button" onClick={loadAudit} className="text-xs text-sky-500 underline">更新</button>
                  </div>
                  {place.reviews.map((review, i) => (
                    <div key={i} className="bg-white rounded-xl shadow-sm p-5">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium text-gray-800">{review.author_name}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-amber-400 text-sm">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
                            <span className="text-xs text-gray-400">{review.relative_time_description}</span>
                          </div>
                        </div>
                        <a href={/^https?:\/\//i.test(place.url || '') ? place.url! : gbpManageUrl} target="_blank" rel="noopener noreferrer"
                           className="text-xs text-sky-500 underline shrink-0">GBPで返信 ↗</a>
                      </div>
                      {review.text && (
                        <p className="text-sm text-gray-600 mt-2">{review.text}</p>
                      )}
                    </div>
                  ))}
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 text-sm text-blue-600">
                    <p className="font-semibold mb-1">返信のコツ</p>
                    <ul className="space-y-1 text-xs">
                      <li>• 24時間以内に返信（Googleのランキングシグナルになる）</li>
                      <li>• 「〇〇（地域）でお探しのお客様に」などの地域キーワードを含める</li>
                      <li>• 星1〜2の低評価には特に丁寧に返信（見ている他のユーザーへの訴求）</li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
                  <p>クチコミデータの取得には <span className="text-sky-500">GOOGLE_MAPS_API_KEY</span> の設定が必要です</p>
                  <p className="text-xs mt-2">Vercelの環境変数に設定してください</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===== GBP投稿 ===== */}
      {tab === 'posts' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">GBP投稿管理</h2>
              <p className="text-xs text-gray-500">投稿を作成してGBP管理画面からコピー貼り付けで投稿できます</p>
            </div>
            <button type="button" onClick={() => setShowPostForm(true)}
                    className="bg-sky-500 text-white text-sm px-4 py-2 rounded-lg hover:bg-sky-600">
              + 新規投稿
            </button>
          </div>

          {/* テンプレート */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-700 mb-3">テンプレートから作成</h3>
            <div className="grid grid-cols-2 gap-2">
              {POST_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() => {
                    setNewPost({ title: tpl.title, body: tpl.body, post_type: 'STANDARD', cta_type: '', cta_url: '' });
                    setShowPostForm(true);
                  }}
                  className="text-left p-3 bg-gray-50 rounded-lg hover:bg-sky-50 hover:text-sky-700 transition-colors text-sm font-medium text-gray-700"
                >
                  📝 {tpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* 投稿フォーム */}
          {showPostForm && (
            <div className="bg-white rounded-xl shadow-sm p-5 border-2 border-sky-200">
              <h3 className="font-bold text-gray-700 mb-4">投稿内容を作成</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">投稿タイプ</label>
                  <select value={newPost.post_type} onChange={(e) => setNewPost((p) => ({ ...p, post_type: e.target.value }))}
                          className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="STANDARD">通常投稿</option>
                    <option value="OFFER">キャンペーン/クーポン</option>
                    <option value="EVENT">イベント</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">タイトル（任意）</label>
                  <input type="text" value={newPost.title} onChange={(e) => setNewPost((p) => ({ ...p, title: e.target.value }))}
                         placeholder="例: 【期間限定】春のキャンペーン"
                         maxLength={58}
                         className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">本文 *</label>
                  <textarea value={newPost.body} onChange={(e) => setNewPost((p) => ({ ...p, body: e.target.value }))}
                            rows={6} maxLength={1500}
                            placeholder="投稿の内容を入力... (最大1500文字)"
                            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                  <p className="text-xs text-right text-gray-400">{newPost.body.length}/1500</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600">CTAボタン（任意）</label>
                    <select value={newPost.cta_type} onChange={(e) => setNewPost((p) => ({ ...p, cta_type: e.target.value }))}
                            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="">なし</option>
                      <option value="BOOK">予約する</option>
                      <option value="ORDER">注文する</option>
                      <option value="LEARN_MORE">詳細を見る</option>
                      <option value="SIGN_UP">登録する</option>
                      <option value="CALL">電話する</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">CTA URL（任意）</label>
                    <input type="url" value={newPost.cta_url} onChange={(e) => setNewPost((p) => ({ ...p, cta_url: e.target.value }))}
                           placeholder="https://..." maxLength={500}
                           className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={savePost} disabled={savingPost || !newPost.body.trim()}
                          className="flex-1 bg-sky-500 text-white text-sm py-2 rounded-lg hover:bg-sky-600 disabled:opacity-50">
                    {savingPost ? '保存中...' : '下書き保存'}
                  </button>
                  <button type="button" onClick={() => setShowPostForm(false)}
                          className="flex-1 bg-gray-100 text-gray-700 text-sm py-2 rounded-lg hover:bg-gray-200">
                    キャンセル
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 投稿一覧 */}
          {postsLoading ? (
            <div className="animate-pulse space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}</div>
          ) : posts.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400 text-sm">
              まだ投稿がありません。上の「テンプレートから作成」で始めましょう。
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <div key={post.id} className={`bg-white rounded-xl shadow-sm p-4 ${post.status === 'published' ? 'border-l-4 border-green-400' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                          post.status === 'published' ? 'bg-green-100 text-green-700' :
                          post.status === 'scheduled' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {post.status === 'published' ? '投稿済み' : post.status === 'scheduled' ? '予定' : '下書き'}
                        </span>
                        <span className="text-xs text-gray-400">{post.post_type}</span>
                        <span className="text-xs text-gray-400">{new Date(post.created_at).toLocaleDateString('ja-JP')}</span>
                      </div>
                      {post.title && <p className="text-sm font-medium text-gray-800">{post.title}</p>}
                      <p className="text-sm text-gray-600 line-clamp-2 mt-0.5">{post.body}</p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {post.status !== 'published' && (
                        <>
                          <a href={gbpManageUrl} target="_blank" rel="noopener noreferrer"
                             onClick={() => markPublished(post.id)}
                             className="text-xs bg-sky-500 text-white px-3 py-1 rounded hover:bg-sky-600 text-center">
                            GBPに投稿 ↗
                          </a>
                        </>
                      )}
                      <button type="button" onClick={() => deletePost(post.id)}
                              className="text-xs bg-red-50 text-red-500 px-3 py-1 rounded hover:bg-red-100">
                        削除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 text-xs text-blue-600">
            <p className="font-semibold mb-1">GBP投稿のベストプラクティス</p>
            <ul className="space-y-1">
              <li>• 週1回以上の投稿がMEOランキングに効く（Googleが「活発な店舗」と判断）</li>
              <li>• 投稿は1500文字以内。最初の100文字が検索結果に表示される</li>
              <li>• 写真付きの投稿はエンゲージメントが2〜3倍高くなる</li>
              <li>• 「予約する」CTAボタンを付けると来店転換率が向上する</li>
            </ul>
          </div>
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
