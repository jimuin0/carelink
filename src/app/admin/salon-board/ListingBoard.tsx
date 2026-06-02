'use client';
/* eslint-disable @next/next/no-img-element -- Supabase Storage の動的URLのため next/image 非対応。掲載写真はサムネイル表示用 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export type ListingTab =
  | 'top' | 'salon' | 'staff' | 'photo' | 'menu'
  | 'kodawari' | 'tokushu' | 'coupon' | 'blog' | 'review';

interface Props {
  facilityId: string;
  salonName: string;
  status: string;
  onToast: (msg: string) => void;
  onReloadStatus?: () => void; // 反映申請等で掲載ステータスが変わった際に親へ再取得を促す
}

interface StaffRow { id: string; name: string; position: string | null; specialties: string[] | null; years_experience: number | null; photo_url: string | null; sort_order: number | null; is_active: boolean; bio: string | null; }
interface PhotoRow { id: string; photo_url: string | null; photo_type: string | null; caption: string | null; sort_order: number | null; title?: string | null; genre?: string | null; search_category?: string | null; image_submission?: boolean | null; is_published?: boolean | null; coupon_id?: string | null; }
interface PhotoDraft { title: string; caption: string; genre: string; search_category: string; image_submission: boolean; is_published: boolean; coupon_id: string; }
interface MenuRow { id: string; category: string | null; name: string; description: string | null; price: number | null; price_note: string | null; duration_minutes: number | null; is_featured: boolean | null; sort_order?: number | null; subcategory?: string | null; search_category?: string | null; reservable?: boolean | null; is_published?: boolean | null; price_show_tilde?: boolean | null; price_ask?: boolean | null; }
interface CouponRow { id: string; name: string; description: string | null; coupon_type: string | null; special_price: number | null; valid_from: string | null; valid_until: string | null; is_active: boolean | null; presentation_timing?: string | null; usage_condition?: string | null; search_category1?: string | null; search_category2?: string | null; duration_minutes?: number | null; image_url?: string | null; image_submission?: boolean | null; sort_order?: number | null; }
interface BlogRow { id: string; title: string; content?: string | null; is_published: boolean | null; published_at: string | null; created_at: string | null; thumbnail_url: string | null; author_id?: string | null; author_name_id?: string | null; coupon_id?: string | null; category?: string | null; scheduled_at?: string | null; image_urls?: string[] | null; }
interface ReviewRow { id: string; reviewer_name: string | null; rating: number | null; comment: string | null; status: string | null; created_at: string | null; visit_date?: string | null; staff_id?: string | null; booking_id?: string | null; reply?: string | null; is_pickup?: boolean | null; }

const NAV: { key: ListingTab; label: string }[] = [
  { key: 'top', label: '掲載管理TOP' },
  { key: 'salon', label: 'サロン' },
  { key: 'staff', label: 'スタッフ' },
  { key: 'photo', label: 'フォトギャラリー' },
  { key: 'menu', label: 'メニュー' },
  { key: 'kodawari', label: 'こだわり' },
  { key: 'tokushu', label: '特集' },
  { key: 'coupon', label: 'クーポン' },
  { key: 'blog', label: 'ブログ' },
  { key: 'review', label: '口コミ' },
];

// HPB 準拠：セクション見出しバー（淡いグレー帯＋左アクセント）
function SectionBar({ children, sub }: { children: React.ReactNode; sub?: boolean }) {
  return sub
    ? <h3 className="text-[13px] font-bold text-gray-700 mt-4 mb-2 flex items-center gap-1"><span className="text-sky-600">■</span>{children}</h3>
    : <div className="bg-gradient-to-b from-sky-100 to-sky-200 border border-slate-300 px-3 py-1.5 text-[13px] font-bold text-gray-700 rounded-t">{children}</div>;
}

// 必須マーク
const Req = () => <span className="inline-block w-2 h-2 rounded-full bg-rose-500 ml-1 align-middle" />;
// 外部リンクアイコン（別ページ遷移を示す ↗）
const ExtIcon = () => <svg className="inline w-3 h-3 ml-0.5 -mt-0.5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>;
// ヘルプ(?)アイコン
const HelpIcon = ({ onClick }: { onClick: () => void }) => <button type="button" onClick={onClick} className="w-5 h-5 rounded-full border border-sky-400 text-sky-500 text-xs leading-none">?</button>;
// 表示プラン確認の小バッジ（CareLink の掲載は無料プランのみ）
const PlanBadge = () => <span className="text-[10px] text-emerald-600 border border-emerald-300 bg-emerald-50 rounded px-1.5 py-0.5">無料プラン</span>;
// 文字数カウンタ
const Counter = ({ n, max }: { n: number; max: number }) => <span className="text-[10px] text-gray-400">{n}<br />/{max}</span>;

function fmtDate(s: string | null): string {
  if (!s) return '—';
  // DATE 型（'YYYY-MM-DD' のみ。valid_until / visit_date 等）は時刻・TZ を持たないため文字列スライス。
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '/');
  // TIMESTAMPTZ（UTC ISO。published_at / created_at 等）は JST(+9h) 換算してから日付を取る（1日ずれ防止）。
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s.slice(0, 10).replace(/-/g, '/');
  const j = new Date(t + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}/${String(j.getUTCMonth() + 1).padStart(2, '0')}/${String(j.getUTCDate()).padStart(2, '0')}`;
}

// 分 → 「N時間M分」表記（HPB 所要目安時間の換算表示）
function minToHM(min: number | null): string {
  if (min == null || min <= 0) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return `${h ? `${h}時間` : ''}${m ? `${m}分` : h ? '' : ''}`;
}
// HPB 文字数カウンタ：半角は 0.5 換算
function hpbLen(s: string): number {
  let n = 0;
  for (const ch of s) n += ch.charCodeAt(0) <= 0xff ? 0.5 : 1;
  return n;
}

const fieldCls = 'border border-gray-300 rounded px-2 py-1 text-sm';

// 入力に応じて文字数カウンタがリアルタイム更新される制御テキスト入力（HPB準拠）
// onValueChange を渡すと親へ最新値を通知（保存フォーム用）
function CharInput({ max, defaultValue = '', placeholder, w = 'flex-1', below = false, onValueChange }: { max: number; defaultValue?: string; placeholder?: string; w?: string; below?: boolean; onValueChange?: (v: string) => void }) {
  const [v, setV] = useState(defaultValue);
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => { setV(e.target.value); onValueChange?.(e.target.value); };
  const counter = <Counter n={hpbLen(v)} max={max} />;
  const field = <input value={v} onChange={onChange} maxLength={max} placeholder={placeholder} className={`${fieldCls} ${w}`} />;
  return below
    ? <><div className="w-full">{field}</div><div className="text-right">{counter}</div></>
    : <div className="flex items-start gap-2 w-full">{field}{counter}</div>;
}
function CharTextarea({ max, defaultValue = '', placeholder, rows = 3, below = true, onValueChange }: { max: number; defaultValue?: string; placeholder?: string; rows?: number; below?: boolean; onValueChange?: (v: string) => void }) {
  const [v, setV] = useState(defaultValue);
  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => { setV(e.target.value); onValueChange?.(e.target.value); };
  const counter = <Counter n={hpbLen(v)} max={max} />;
  const field = <textarea value={v} onChange={onChange} rows={rows} maxLength={max} placeholder={placeholder} className={`${fieldCls} w-full`} />;
  return below
    ? <>{field}<div className="text-right">{counter}</div></>
    : <div className="flex items-start gap-2 w-full">{field}{counter}</div>;
}
// 所要目安時間：入力分数に応じて「N時間M分」をリアルタイム換算表示
function DurationInput({ defaultValue, onValueChange }: { defaultValue?: number | null; onValueChange?: (v: string) => void }) {
  const [v, setV] = useState(defaultValue != null ? String(defaultValue) : '');
  const hm = minToHM(parseInt(v, 10) || 0);
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => { const nv = e.target.value.replace(/[^0-9]/g, ''); setV(nv); onValueChange?.(nv); };
  return (
    <span className="flex items-center gap-3">
      <input value={v} onChange={onChange} className={`${fieldCls} w-16`} /><span className="text-xs">分</span>
      {hm && <span className="text-xs text-gray-600">{hm}</span>}
      <span className="text-[10px] text-gray-400">※予約時の時間計算に利用します</span>
    </span>
  );
}

export default function ListingBoard({ facilityId, salonName, status, onToast, onReloadStatus }: Props) {
  const [tab, setTab] = useState<ListingTab>('top');
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [menus, setMenus] = useState<MenuRow[]>([]);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [blogs, setBlogs] = useState<BlogRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [slug, setSlug] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = createBrowserSupabaseClient();
      const { data } = await sb.from('facility_profiles').select('slug').eq('id', facilityId).maybeSingle();
      if (!cancelled) setSlug((data as { slug: string } | null)?.slug ?? '');
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [facilityId]);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createBrowserSupabaseClient();
    const [st, ph, mn, cp, bl, rv] = await Promise.all([
      sb.from('staff_profiles').select('id,name,position,specialties,years_experience,photo_url,sort_order,is_active,bio').eq('facility_id', facilityId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      sb.from('facility_photos').select('*').eq('facility_id', facilityId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      sb.from('facility_menus').select('*').eq('facility_id', facilityId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      sb.from('coupons').select('*').eq('facility_id', facilityId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      sb.from('blog_posts').select('*').eq('facility_id', facilityId).order('created_at', { ascending: false }),
      sb.from('facility_reviews').select('*').eq('facility_id', facilityId).order('created_at', { ascending: false }),
    ]);
    // Supabase はクエリ失敗時に throw せず { data:null, error } を返すため error を検査する。
    // エラー時に空配列で確定上書きすると「未登録/0件」と誤表示するため、上書きしない。
    if (st.error || ph.error || mn.error || cp.error || bl.error || rv.error) {
      onToast('掲載情報の読み込みに失敗しました。再読み込みしてください');
    }
    if (!st.error) setStaff((st.data as StaffRow[]) ?? []);
    if (!ph.error) setPhotos((ph.data as PhotoRow[]) ?? []);
    if (!mn.error) setMenus((mn.data as MenuRow[]) ?? []);
    if (!cp.error) setCoupons((cp.data as CouponRow[]) ?? []);
    if (!bl.error) setBlogs((bl.data as BlogRow[]) ?? []);
    if (!rv.error) setReviews((rv.data as ReviewRow[]) ?? []);
    setLoading(false);
  }, [facilityId, onToast]);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  // クーポンのみ軽量再取得（全画面スケルトンを出さず保存後に一覧反映）
  const reloadCoupons = useCallback(async () => {
    const sb = createBrowserSupabaseClient();
    const { data } = await sb.from('coupons').select('*').eq('facility_id', facilityId).order('sort_order', { ascending: true }).order('created_at', { ascending: true });
    setCoupons((data as CouponRow[]) ?? []);
  }, [facilityId]);

  const reloadMenus = useCallback(async () => {
    const sb = createBrowserSupabaseClient();
    const { data } = await sb.from('facility_menus').select('*').eq('facility_id', facilityId).order('sort_order', { ascending: true }).order('created_at', { ascending: true });
    setMenus((data as MenuRow[]) ?? []);
  }, [facilityId]);

  const reloadBlogs = useCallback(async () => {
    const sb = createBrowserSupabaseClient();
    const { data } = await sb.from('blog_posts').select('*').eq('facility_id', facilityId).order('created_at', { ascending: false });
    setBlogs((data as BlogRow[]) ?? []);
  }, [facilityId]);

  const reloadPhotos = useCallback(async () => {
    const sb = createBrowserSupabaseClient();
    const { data } = await sb.from('facility_photos').select('*').eq('facility_id', facilityId).order('sort_order', { ascending: true }).order('created_at', { ascending: true });
    setPhotos((data as PhotoRow[]) ?? []);
  }, [facilityId]);

  const reloadStaff = useCallback(async () => {
    const sb = createBrowserSupabaseClient();
    const { data } = await sb.from('staff_profiles').select('id,name,position,specialties,years_experience,photo_url,sort_order,is_active,bio').eq('facility_id', facilityId).order('sort_order', { ascending: true }).order('created_at', { ascending: true });
    setStaff((data as StaffRow[]) ?? []);
  }, [facilityId]);

  const reloadReviews = useCallback(async () => {
    const sb = createBrowserSupabaseClient();
    const { data } = await sb.from('facility_reviews').select('*').eq('facility_id', facilityId).order('created_at', { ascending: false });
    setReviews((data as ReviewRow[]) ?? []);
  }, [facilityId]);

  const statusLabel = status === 'published' ? '掲載中' : status === 'suspended' ? '停止中' : '下書き';

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      {/* 二次ナビ（青タブ） */}
      <nav className="flex items-stretch gap-px bg-sky-700 px-2 overflow-x-auto whitespace-nowrap">
        {NAV.map((n) => (
          <button key={n.key} type="button" onClick={() => setTab(n.key)}
            className={`px-3 py-2 text-xs font-bold rounded-t mt-1 ${tab === n.key ? 'bg-white text-sky-700' : 'bg-sky-600 text-white hover:bg-sky-500'}`}>{n.label}</button>
        ))}
      </nav>

      <div className="p-5">
        {loading ? (
          <div className="animate-pulse space-y-3"><div className="h-8 bg-gray-200 rounded w-64" /><div className="h-40 bg-gray-200 rounded max-w-3xl" /></div>
        ) : (
          <>
            {tab === 'top' && <TopPage salonName={salonName} statusLabel={statusLabel} slug={slug} facilityId={facilityId} reviewsCount={reviews.length} ratingAvg={reviews.length ? Math.round((reviews.reduce((s, r) => s + (r.rating ?? 0), 0) / reviews.length) * 10) / 10 : 0} counts={{ staff: staff.length, photos: photos.length, menus: menus.length, coupons: coupons.length }} onToast={onToast} onReloadStatus={onReloadStatus} />}
            {tab === 'salon' && <SalonEditPage salonName={salonName} facilityId={facilityId} photos={photos} onReloadPhotos={reloadPhotos} onToast={onToast} />}
            {tab === 'staff' && <StaffListPage rows={staff} facilityId={facilityId} onReload={reloadStaff} onToast={onToast} />}
            {tab === 'photo' && <PhotoEditPage rows={photos} coupons={coupons} facilityId={facilityId} onReload={reloadPhotos} onToast={onToast} />}
            {tab === 'menu' && <MenuEditPage rows={menus} facilityId={facilityId} onReload={reloadMenus} onToast={onToast} />}
            {tab === 'kodawari' && <KodawariPage />}
            {tab === 'tokushu' && <TokushuPage />}
            {tab === 'coupon' && <CouponListPage rows={coupons} facilityId={facilityId} onReload={reloadCoupons} onToast={onToast} />}
            {tab === 'blog' && <BlogListPage rows={blogs} staff={staff} coupons={coupons} facilityId={facilityId} onReload={reloadBlogs} onToast={onToast} />}
            {tab === 'review' && <ReviewListPage rows={reviews} staff={staff} facilityId={facilityId} onReload={reloadReviews} onToast={onToast} />}
          </>
        )}
      </div>
    </div>
  );
}

/* ========================= 掲載管理TOP ========================= */
function TopPage({ salonName, statusLabel, slug, facilityId, reviewsCount, ratingAvg, counts, onToast, onReloadStatus }: { salonName: string; statusLabel: string; slug: string; facilityId: string; reviewsCount: number; ratingAvg: number; counts: { staff: number; photos: number; menus: number; coupons: number }; onToast: (m: string) => void; onReloadStatus?: () => void }) {
  const openPreview = () => { if (slug) window.open(`/salon/${slug}`, '_blank', 'noopener'); else onToast('公開URLが未設定です'); };
  const [applying, setApplying] = useState(false);
  const [checkModal, setCheckModal] = useState(false);
  const [reportModal, setReportModal] = useState(false);
  const checks = [
    { label: 'サロン基本情報（サロン名）', ok: !!salonName && salonName !== '—' },
    { label: 'スタッフ掲載情報', ok: counts.staff > 0 },
    { label: 'フォトギャラリー（写真1枚以上）', ok: counts.photos > 0 },
    { label: 'メニュー掲載情報', ok: counts.menus > 0 },
  ];
  const applyPublish = async () => {
    if (applying) return; setApplying(true);
    try {
      const res = await fetch(`/api/admin/facility-status?facility_id=${facilityId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '反映申請に失敗しました'); return; }
      onToast('反映申請しました（掲載を公開しました）');
      onReloadStatus?.(); // 親(SalonBoard)の掲載ステータス表示を再取得して stale を解消
    } catch { onToast('通信エラーが発生しました'); } finally { setApplying(false); }
  };
  const today = '2026/05/29';
  const rows: { label: string; label2?: string; editor: string; date: string; check: string; empty?: boolean; reflect: { applied: boolean; at: string } | null }[] = [
    { label: 'サロン掲載情報', editor: '太田由香利', date: '2026/02/10', check: '要確認', reflect: { applied: true, at: '2026/05/02 15:25' } },
    { label: 'スタッフ掲載情報一覧', label2: 'スタッフ掲載情報', editor: '太田由香利', date: '2024/09/14', check: '', reflect: null },
    { label: 'フォトギャラリー掲載情報', editor: '太田由香利', date: '2024/12/13', check: '', reflect: null },
    { label: 'メニュー掲載情報', editor: '太田由香利', date: '2026/05/02', check: '', reflect: null },
    { label: 'こだわり掲載情報一覧', label2: 'こだわり掲載情報', editor: '', date: '', check: '', empty: true, reflect: null },
    { label: '特集用掲載情報', editor: '太田由香利', date: '2026/04/23', check: '', reflect: { applied: true, at: '2026/04/23 16:17' } },
    { label: 'クーポン掲載情報', editor: '太田由香利', date: '2026/05/29', check: '', reflect: { applied: true, at: '2026/05/29 20:32' } },
  ];
  return (
    <div className="max-w-4xl space-y-5">
      {checkModal && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setCheckModal(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-800">掲載チェック</h3><button onClick={() => setCheckModal(false)} className="text-gray-400 text-lg leading-none">×</button></div>
            <ul className="space-y-1 text-sm">{checks.map((c) => <li key={c.label} className="flex items-center gap-2"><span className={c.ok ? 'text-emerald-600' : 'text-rose-500'}>{c.ok ? '✓ OK' : '✕ 未登録'}</span><span className="text-gray-700">{c.label}</span></li>)}</ul>
            <p className="text-[11px] text-gray-400 mt-3">※「未登録」項目があると掲載品質が下がります。各タブから登録してください。</p>
          </div>
        </div>
      )}
      {reportModal && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setReportModal(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-800">サロンレポート（概要）</h3><button onClick={() => setReportModal(false)} className="text-gray-400 text-lg leading-none">×</button></div>
            <table className="w-full text-sm"><tbody>
              {[['スタッフ', `${counts.staff} 名`], ['掲載写真', `${counts.photos} 枚`], ['メニュー', `${counts.menus} 件`], ['クーポン', `${counts.coupons} 件`], ['口コミ', `${reviewsCount} 件`], ['平均評価', reviewsCount ? `★ ${ratingAvg}` : '—']].map(([k, v]) => <tr key={k} className="border-b border-slate-100"><td className="py-1.5 text-gray-500">{k}</td><td className="py-1.5 text-right font-bold text-gray-800">{v}</td></tr>)}
            </tbody></table>
            <p className="text-[11px] text-gray-400 mt-3">※詳細な月次分析は「集計・分析」で提供予定です。</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between"><h2 className="text-base font-bold text-gray-800">掲載管理TOP</h2><HelpIcon onClick={() => onToast('ヘルプは準備中です')} /></div>

      <div>
        <SectionBar>サロンレポート</SectionBar>
        <div className="border border-t-0 border-slate-300 bg-white px-4 py-3 text-sm space-y-1.5 rounded-b">
          <p><button onClick={() => setReportModal(true)} className="text-sky-600 underline">サロンレポート ダウンロード画面</button> <span className="text-gray-500 text-xs">月ごとのレポートを作成してダウンロードすることができます。</span></p>
          <p><button onClick={() => setReportModal(true)} className="text-sky-600 underline">HOT PEPPER Beauty レポート</button> <span className="text-gray-500 text-xs">レポート作成を待たずに概要を確認することができます。</span></p>
        </div>
      </div>

      <div>
        <SectionBar>営業が設定しているページの確認</SectionBar>
        <div className="border border-t-0 border-slate-300 bg-white px-4 py-3 text-sm rounded-b">
          <SectionBar sub>サロン基本情報</SectionBar>
          <button onClick={openPreview} className="text-sky-600 underline text-sm">プレビューを見る<ExtIcon /></button>
        </div>
      </div>

      <div>
        <SectionBar>掲載中ページ・作成中のプレビュー確認</SectionBar>
        <div className="border border-t-0 border-slate-300 bg-white px-4 py-3 rounded-b">
          <SectionBar sub>掲載中ページ</SectionBar>
          <table className="w-full text-sm border border-slate-200">
            <thead><tr className="bg-amber-50 text-gray-600 text-xs">
              <th className="border border-slate-200 px-3 py-1.5 font-bold">最終反映日</th>
              <th className="border border-slate-200 px-3 py-1.5 font-bold">反映者</th>
              <th className="border border-slate-200 px-3 py-1.5 font-bold">プレビュー</th>
            </tr></thead>
            <tbody><tr className="text-center">
              <td className="border border-slate-200 px-3 py-2">{today}</td>
              <td className="border border-slate-200 px-3 py-2">太田由香利</td>
              <td className="border border-slate-200 px-3 py-2"><button onClick={openPreview} className="text-sky-600 underline">掲載中のページを見る<ExtIcon /></button></td>
            </tr></tbody>
          </table>
        </div>
      </div>

      <div>
        <SectionBar sub>反映状況とプレビュー</SectionBar>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs text-gray-600">表示するプラン：</span>
          <select className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"><option>無料プラン</option></select>
        </div>
        <ul className="text-[11px] text-gray-400 space-y-0.5 mb-3 leading-relaxed">
          <li>※ 掲載する写真や動画に関しては第三者の権利を侵害しないことを確認するものとします。</li>
          <li>※ HOT PEPPER Beautyの掲載基準、表記ルールに違反しないようにしてください。</li>
          <li>※ 編集した内容をネット上に掲載します。</li>
          <li>※ 掲載チェックに「NG」がある場合、または「未確認の掲載情報」がある場合、「反映申請」ボタンは押せません。</li>
        </ul>
        <table className="w-full text-sm border border-slate-200">
          <thead><tr className="bg-amber-50 text-gray-600 text-xs">
            {['プレビュー', '登録履歴', '掲載チェック', '詳細', '反映申請'].map((h) => <th key={h} className="border border-slate-200 px-3 py-1.5 font-bold">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={r.empty ? 'text-gray-400' : ''}>
                <td className="border border-slate-200 px-3 py-3"><button onClick={openPreview} className="text-sky-600 underline">{r.label}<ExtIcon /></button>{r.label2 && <><br /><button onClick={openPreview} className="text-sky-600 underline">{r.label2}<ExtIcon /></button></>}</td>
                <td className="border border-slate-200 px-3 py-3 text-center text-xs">{r.empty ? '' : <>{r.editor}<br />({r.date})</>}</td>
                <td className="border border-slate-200 px-3 py-3 text-center">{r.empty ? <span className="text-rose-500 text-xs">現在、こだわり掲載情報はありません。</span> : r.check ? <button onClick={() => setCheckModal(true)} className="text-rose-500 underline text-xs">{r.check}</button> : ''}</td>
                <td className="border border-slate-200 px-3 py-3 text-center"></td>
                <td className="border border-slate-200 px-3 py-3 text-center text-xs">
                  {r.reflect ? (<><span className="text-emerald-600 font-bold">反映済み</span><br /><button disabled={applying} onClick={applyPublish} className="mt-1 px-2 py-0.5 bg-gray-200 rounded text-gray-600 disabled:opacity-40">反映申請</button><br />({r.reflect.at})</>) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-gray-500 mt-3">反映までに通常15分程度かかります。システムメンテナンスなどによっては15分以上かかる場合があります。</p>
        <div className="text-right mt-2"><button onClick={(e) => { const sc = (e.currentTarget as HTMLElement).closest('.overflow-auto'); if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' }); else window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="text-[11px] text-sky-600 underline">← ページのトップへ</button></div>
        <p className="text-[11px] text-gray-400 mt-3">掲載中サロン：<span className="font-bold text-gray-600">{salonName}</span>（{statusLabel}） / スタッフ {counts.staff}名・写真 {counts.photos}枚・メニュー {counts.menus}件・クーポン {counts.coupons}件</p>
      </div>
    </div>
  );
}

/* ========================= サロン掲載情報編集 ========================= */
function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex border-b border-slate-200 last:border-0">
      <div className="w-40 shrink-0 bg-amber-50 px-3 py-3 text-xs font-bold text-gray-600 flex items-center">{label}{required && <Req />}</div>
      <div className="flex-1 px-3 py-3 text-sm">{children}</div>
    </div>
  );
}
function Panel({ title, children, plan }: { title: string; children: React.ReactNode; plan?: boolean }) {
  return (
    <div className="bg-white border border-slate-300 rounded">
      <div className="bg-gradient-to-b from-sky-100 to-sky-200 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between rounded-t">
        <span className="text-[13px] font-bold text-gray-700">{title}</span>
        {plan && <PlanBadge />}
      </div>
      <div>{children}</div>
    </div>
  );
}

/* サロン編集 TOP写真／雰囲気写真の実データグリッド（削除・前へ/後ろへ・画像応募・キャプションを即時反映）。
   フォトギャラリー(PhotoEditPage)と同じ /api/admin/photos エンドポイントを再利用する。 */
function SalonPhotoGrid({ photos, withCaption, slotClass, onReload, onToast }: { photos: PhotoRow[]; withCaption: boolean; slotClass: string; onReload: () => void; onToast: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [caps, setCaps] = useState<Record<string, string>>(() => Object.fromEntries(photos.map((p) => [p.id, p.caption ?? ''])));
  useEffect(() => {
    setCaps((prev) => {
      const next = { ...prev }; let changed = false;
      for (const p of photos) if (!(p.id in next)) { next[p.id] = p.caption ?? ''; changed = true; }
      return changed ? next : prev;
    });
  }, [photos]);
  const remove = async (id: string) => {
    if (busy || !confirm('この写真を削除しますか？')) return; setBusy(true);
    try {
      const res = await fetch(`/api/admin/photos/${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '削除に失敗しました'); return; }
      onToast('写真を削除しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setBusy(false); }
  };
  const patch = async (id: string, body: Record<string, unknown>, okMsg?: string) => {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/admin/photos/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); return; }
      if (okMsg) onToast(okMsg); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setBusy(false); }
  };
  // 隣接2枚の表示順(sort_order)をインデックス基準で入れ替える（既存値が同値/欠損でも確実に並ぶ）
  const move = async (i: number, dir: -1 | 1) => {
    const a = photos[i]; const b = photos[i + dir];
    if (!a || !b || busy) return; setBusy(true);
    try {
      for (const [id, so] of [[a.id, i + dir], [b.id, i]] as [string, number][]) {
        const res = await fetch(`/api/admin/photos/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort_order: so }) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '並び替えに失敗しました'); setBusy(false); return; }
      }
      onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setBusy(false); }
  };
  const saveCaption = (p: PhotoRow) => { const v = caps[p.id] ?? ''; if (v !== (p.caption ?? '')) patch(p.id, { caption: v || null }, '保存しました'); };
  if (photos.length === 0) return <p className="text-xs text-gray-400 px-3 py-3">登録された写真はありません。「画像をアップロードする」から追加してください。</p>;
  return (
    <>
      {photos.map((p, i) => (
        <div key={p.id} className={`${slotClass} text-center`}>
          <div className={`${withCaption ? 'w-full h-28' : 'w-24 h-20'} bg-gray-100 relative`}>
            {p.photo_url ? <img src={p.photo_url} alt="" className="w-full h-full object-cover" /> : null}
            <button disabled={busy} onClick={() => remove(p.id)} className="absolute top-0 right-0 w-4 h-4 bg-gray-500 text-white text-[10px] leading-none disabled:opacity-40">×</button>
          </div>
          <div className="text-[9px] text-gray-400 mt-0.5">画像ID:C{p.id.slice(0, 8).toUpperCase()}</div>
          <label className="flex items-center justify-center gap-0.5 text-[9px] text-gray-500"><input type="checkbox" checked={p.image_submission ?? false} disabled={busy} onChange={(e) => patch(p.id, { image_submission: e.target.checked })} />画像応募</label>
          {withCaption && <div className="flex items-start gap-1 mt-1"><textarea className="border border-gray-300 rounded px-1 py-0.5 text-[11px] w-full" rows={2} maxLength={30} placeholder="キャプション" value={caps[p.id] ?? ''} onChange={(e) => setCaps((m) => ({ ...m, [p.id]: e.target.value }))} onBlur={() => saveCaption(p)} /></div>}
          <div className="flex justify-center gap-1 mt-0.5 text-[9px]"><button disabled={busy || i === 0} onClick={() => move(i, -1)} className="px-1 bg-sky-100 text-sky-600 rounded disabled:opacity-40">前へ</button><button disabled={busy || i === photos.length - 1} onClick={() => move(i, 1)} className="px-1 bg-sky-100 text-sky-600 rounded disabled:opacity-40">後ろへ</button></div>
        </div>
      ))}
    </>
  );
}

function SalonEditPage({ salonName, facilityId, photos, onReloadPhotos, onToast }: { salonName: string; facilityId: string; photos: PhotoRow[]; onReloadPhotos: () => void; onToast: (m: string) => void }) {
  // 単純カラムに対応する主要項目を保存対象とする（キャッチ/コピー/アクセス/定休日）
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formKey, setFormKey] = useState(0); // キャンセル時に未制御入力(CharInput等)を再マウントしてリセット
  const [equipCount, setEquipCount] = useState(3); // 設備明細の表示行数（「追加する」で増やせる）
  const [staffCount, setStaffCount] = useState(3); // スタッフ数明細の表示行数
  const [imgs, setImgs] = useState<{ header: string; logo: string; owner: string }>({ header: '', logo: '', owner: '' });
  const [design, setDesign] = useState<{ template: string; color: string }>({ template: '', color: '' });
  const [uploading, setUploading] = useState(false);
  const imgFileRef = useRef<HTMLInputElement>(null);
  const imgTarget = useRef<'header' | 'logo' | 'owner' | 'top' | 'atmos'>('header');
  const pickImg = (t: 'header' | 'logo' | 'owner' | 'top' | 'atmos') => { imgTarget.current = t; imgFileRef.current?.click(); };
  const onImgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { onToast('JPG, PNG, WebPのみ対応しています'); return; }
    if (file.size > 5 * 1024 * 1024) { onToast('ファイルサイズは5MB以下にしてください'); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const up = await fetch(`/api/admin/photos/upload?facility_id=${facilityId}`, { method: 'POST', body: fd });
      if (!up.ok) { const d = await up.json().catch(() => ({})); onToast(d.error || '画像のアップロードに失敗しました'); setUploading(false); return; }
      const { url } = await up.json();
      const t = imgTarget.current;
      if (t === 'header' || t === 'logo' || t === 'owner') { setImgs((m) => ({ ...m, [t]: url })); onToast('画像をアップロードしました（登録ボタンで保存）'); }
      else { // TOP写真/雰囲気写真 → ギャラリーに登録
        const res = await fetch(`/api/admin/photos?facility_id=${facilityId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo_url: url, photo_type: t === 'top' ? 'main' : 'other' }) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); setUploading(false); return; }
        onToast(t === 'top' ? 'TOP写真を追加しました' : '雰囲気写真を追加しました');
        onReloadPhotos();
      }
    } catch { onToast('通信エラーが発生しました'); } finally { setUploading(false); }
  };
  const fields = useRef({ catch_copy: '', description: '', access_info: '', regular_holiday: '', business_hours_text: '', directions: '', remarks: '', owner_name: '', owner_title: '', owner_message: '', payment_other: '', parking_text: '' });
  const website = useRef<string>(''); // 既存値を保持して保存時に消さない（settingsは未送信でnull化するため）
  const featureSet = useRef<Set<string>>(new Set()); // こだわり条件/サービス/支払い/メンズ等のチェック集約 → features配列
  const counts = useRef({ seat: '', staff: '' }); // 設備総数 → seat_count, スタッフ総数 → staff_count
  const genres = useRef<string[]>(['', '', '', '', '', '']); // ジャンル6枠
  const equip = useRef<{ name: string; count: string }[]>([{ name: '', count: '' }, { name: '', count: '' }, { name: '', count: '' }]); // 設備明細
  const staffRows = useRef<{ role: string; count: string }[]>([{ role: '', count: '' }, { role: '', count: '' }, { role: '', count: '' }]); // スタッフ数明細
  const extEnabled = useRef(false); // 拡張カラム(business_hours_text等)がDBに存在するか
  const snapshot = useRef<{ fields: typeof fields.current; website: string; features: string[]; counts: typeof counts.current; genres: string[]; equip: typeof equip.current; staffRows: typeof staffRows.current; imgs: { header: string; logo: string; owner: string }; design: { template: string; color: string } } | null>(null);
  const toggleFeature = (label: string, on: boolean) => { if (on) featureSet.current.add(label); else featureSet.current.delete(label); };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = createBrowserSupabaseClient();
      // 拡張カラムを明示selectし、エラー(マイグレーション未適用)なら基本カラムのみで再取得
      let d: Record<string, unknown> = {};
      const extCols = 'catch_copy,description,access_info,regular_holiday,website_url,features,seat_count,staff_count,business_hours_text,directions,remarks,owner_name,owner_title,owner_message,genres,equipment,staff_breakdown,header_photo_url,logo_url,owner_photo_url,design_template,design_color,payment_other,parking_text';
      const extRes = await sb.from('facility_profiles').select(extCols).eq('id', facilityId).maybeSingle();
      if (!extRes.error) { extEnabled.current = true; d = (extRes.data as Record<string, unknown> | null) ?? {}; }
      else { extEnabled.current = false; const base = await sb.from('facility_profiles').select('catch_copy,description,access_info,regular_holiday,website_url,features,seat_count,staff_count').eq('id', facilityId).maybeSingle(); d = (base.data as Record<string, unknown> | null) ?? {}; }
      if (!cancelled) {
        const s = (k: string) => (d[k] as string) ?? '';
        fields.current = { catch_copy: s('catch_copy'), description: s('description'), access_info: s('access_info'), regular_holiday: s('regular_holiday'), business_hours_text: s('business_hours_text'), directions: s('directions'), remarks: s('remarks'), owner_name: s('owner_name'), owner_title: s('owner_title'), owner_message: s('owner_message'), payment_other: s('payment_other'), parking_text: s('parking_text') };
        website.current = s('website_url');
        featureSet.current = new Set(Array.isArray(d.features) ? (d.features as string[]) : []);
        counts.current = { seat: d.seat_count != null ? String(d.seat_count) : '', staff: d.staff_count != null ? String(d.staff_count) : '' };
        const g = Array.isArray(d.genres) ? (d.genres as string[]) : [];
        genres.current = [0, 1, 2, 3, 4, 5].map((i) => g[i] ?? '');
        const eq = Array.isArray(d.equipment) ? (d.equipment as { name: string; count: number }[]) : [];
        equip.current = Array.from({ length: Math.max(3, eq.length) }, (_, i) => ({ name: eq[i]?.name ?? '', count: eq[i]?.count != null ? String(eq[i].count) : '' }));
        setEquipCount(Math.max(3, eq.length));
        const sbk = Array.isArray(d.staff_breakdown) ? (d.staff_breakdown as { role: string; count: number }[]) : [];
        staffRows.current = Array.from({ length: Math.max(3, sbk.length) }, (_, i) => ({ role: sbk[i]?.role ?? '', count: sbk[i]?.count != null ? String(sbk[i].count) : '' }));
        setStaffCount(Math.max(3, sbk.length));
        const loadedImgs = { header: s('header_photo_url'), logo: s('logo_url'), owner: s('owner_photo_url') };
        const loadedDesign = { template: s('design_template') || 'standard', color: s('design_color') || 'pink' };
        setImgs(loadedImgs);
        setDesign(loadedDesign);
        // キャンセル時に復元するためのスナップショット（deep copy）
        snapshot.current = {
          fields: { ...fields.current }, website: website.current, features: Array.from(featureSet.current),
          counts: { ...counts.current }, genres: [...genres.current], equip: equip.current.map((e) => ({ ...e })),
          staffRows: staffRows.current.map((e) => ({ ...e })), imgs: { ...loadedImgs }, design: { ...loadedDesign },
        };
        setLoaded(true);
      }
    })().catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, [facilityId]);

  const save = async () => {
    if (saving) return; setSaving(true);
    try {
      const features = Array.from(featureSet.current);
      const cardTypes = ['Visa', 'Mastercard', 'JCB', 'American Express', 'Diners Club', 'UnionPay（銀聯）', 'Discover'];
      const base = {
        name: salonName, catch_copy: fields.current.catch_copy, description: fields.current.description, access_info: fields.current.access_info, regular_holiday: fields.current.regular_holiday, website_url: website.current || '',
        features,
        seat_count: counts.current.seat ? parseInt(counts.current.seat, 10) : null,
        staff_count: counts.current.staff ? parseInt(counts.current.staff, 10) : null,
        parking: features.includes('駐車場あり'),
        credit_card: features.some((f) => cardTypes.includes(f)),
      };
      const ext = extEnabled.current ? {
        business_hours_text: fields.current.business_hours_text, directions: fields.current.directions, remarks: fields.current.remarks,
        payment_other: fields.current.payment_other, parking_text: fields.current.parking_text,
        owner_name: fields.current.owner_name, owner_title: fields.current.owner_title, owner_message: fields.current.owner_message,
        genres: genres.current.filter((x) => x && x !== '未選択'),
        equipment: equip.current.filter((e) => e.name.trim()).map((e) => ({ name: e.name.trim(), count: e.count ? parseInt(e.count, 10) : 0 })),
        staff_breakdown: staffRows.current.filter((e) => e.role.trim()).map((e) => ({ role: e.role.trim(), count: e.count ? parseInt(e.count, 10) : 0 })),
        header_photo_url: imgs.header || null, logo_url: imgs.logo || null, owner_photo_url: imgs.owner || null,
        design_template: design.template || null, design_color: design.color || null,
      } : {};
      const payload = { ...base, ...ext };
      const res = await fetch(`/api/admin/settings?facility_id=${facilityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); setSaving(false); return; }
      onToast('サロン掲載情報を保存しました'); setSaving(false);
    } catch { onToast('通信エラーが発生しました'); setSaving(false); }
  };
  // キャンセル：最後に読み込んだ値へ全入力を復元し、未制御入力を再マウント
  const reset = () => {
    const snap = snapshot.current;
    if (snap) {
      fields.current = { ...snap.fields };
      website.current = snap.website;
      featureSet.current = new Set(snap.features);
      counts.current = { ...snap.counts };
      genres.current = [...snap.genres];
      equip.current = snap.equip.map((e) => ({ ...e }));
      staffRows.current = snap.staffRows.map((e) => ({ ...e }));
      setEquipCount(Math.max(3, snap.equip.length));
      setStaffCount(Math.max(3, snap.staffRows.length));
      setImgs({ ...snap.imgs });
      setDesign({ ...snap.design });
    }
    setFormKey((k) => k + 1);
    onToast('変更を取り消しました');
  };
  // こだわり/サービス/支払い等のチェック（features集約・初期値プリフィル）
  const Feat = ({ label }: { label: string }) => (
    <label className="flex items-center gap-1"><input type="checkbox" defaultChecked={featureSet.current.has(label)} onChange={(e) => toggleFeature(label, e.target.checked)} />{label}</label>
  );

  const SaveBar = () => (
    <div className="flex items-center justify-end gap-2">
      <span className="text-[11px] text-rose-500 mr-auto flex items-center"><Req />必須項目</span>
      <button disabled={saving} onClick={save} className="px-6 py-1.5 bg-sky-500 text-white text-sm font-bold rounded hover:bg-sky-600 disabled:opacity-50">{saving ? '保存中…' : '登録'}</button>
      <button onClick={reset} className="px-6 py-1.5 bg-gray-400 text-white text-sm font-bold rounded hover:bg-gray-500">キャンセル</button>
    </div>
  );
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
  // TOP写真=photo_type 'main'、雰囲気写真=photo_type 'other'（フォトギャラリーと同じ facility_photos を共有）
  const topPhotos = photos.filter((p) => p.photo_type === 'main');
  const atmosPhotos = photos.filter((p) => p.photo_type === 'other');
  if (!loaded) return <div className="max-w-4xl"><div className="animate-pulse h-40 bg-gray-200 rounded" /></div>;
  return (
    <div key={formKey} className="max-w-4xl space-y-4">
      <h2 className="text-base font-bold text-gray-800">サロン掲載情報編集</h2>
      <p className="text-[11px] text-gray-500">※「画像応募」にチェックをすると、Hot Pepper Beautyサイトの特集/メルマガ/装飾・バナー/公式Facebookページ等に使用される対象となります。 <button onClick={() => onToast('使用事例は準備中です')} className="text-sky-600 underline">使用事例はこちら</button></p>
      <SaveBar />

      <Panel title="デザインテンプレート設定" plan>
        <FormRow label="デザインテンプレート">
          <p className="text-xs text-gray-500 mb-2">デザインとカラーを選択して、デザインテンプレートをカスタマイズすることができます。</p>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-500">デザイン</span>
            <select className={`${input} bg-white`} value={design.template} onChange={(e) => setDesign((d) => ({ ...d, template: e.target.value }))}>
              <option value="standard">スタンダード</option><option value="elegant">エレガント</option><option value="natural">ナチュラル</option><option value="cute">キュート</option>
            </select>
            <span className="text-xs text-gray-500">カラー</span>
            <select className={`${input} bg-white`} value={design.color} onChange={(e) => setDesign((d) => ({ ...d, color: e.target.value }))}>
              <option value="pink">ピンク</option><option value="blue">ブルー</option><option value="green">グリーン</option><option value="brown">ブラウン</option><option value="black">ブラック</option>
            </select>
            <span className="inline-block w-8 h-8 rounded border border-gray-300" style={{ backgroundColor: ({ pink: '#f9a8d4', blue: '#93c5fd', green: '#86efac', brown: '#d6b08c', black: '#374151' } as Record<string, string>)[design.color] || '#eee' }} />
          </div>
          <p className="text-[11px] text-gray-400 mt-2">※「登録」で保存されます。</p>
        </FormRow>
      </Panel>

      <input ref={imgFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onImgFile} />
      <Panel title="サロンヘッダー" plan>
        <FormRow label="サロンヘッダー写真">
          {imgs.header
            ? <div className="relative w-full max-w-md"><img src={imgs.header} alt="" className="w-full max-w-md h-32 object-cover rounded" /><button onClick={() => setImgs((m) => ({ ...m, header: '' }))} className="absolute top-1 right-1 w-5 h-5 bg-gray-600 text-white text-xs rounded">×</button></div>
            : <div className="w-full max-w-md h-32 border-2 border-dashed border-gray-300 rounded flex items-center justify-center text-sm text-gray-400 cursor-pointer hover:bg-gray-50" onClick={() => !uploading && pickImg('header')}>{uploading ? 'アップロード中…' : <>画像を<br />アップロードする</>}</div>}
          <button onClick={() => onToast('使用できる写真は準備中です')} className="text-sky-600 underline text-xs mt-1">使用できる写真について</button>
        </FormRow>
      </Panel>

      <Panel title="サロントップ" plan>
        <FormRow label="キャッチ" required><CharInput max={50} placeholder="キャッチコピー" below defaultValue={fields.current.catch_copy} onValueChange={(v) => { fields.current.catch_copy = v; }} /></FormRow>
        <FormRow label="コピー" required><CharTextarea max={150} rows={3} placeholder="サロンの紹介文" defaultValue={fields.current.description} onValueChange={(v) => { fields.current.description = v; }} /></FormRow>
        <FormRow label="ＴＯＰ写真" required>
          <div className="flex flex-wrap gap-2 items-start">
            <SalonPhotoGrid photos={topPhotos} withCaption={false} slotClass="w-24" onReload={onReloadPhotos} onToast={onToast} />
            <div className="w-24 h-20 border border-gray-300 bg-sky-50 flex items-center justify-center text-[10px] text-sky-600 cursor-pointer" onClick={() => !uploading && pickImg('top')}>{uploading ? '中…' : <>画像を<br />アップロードする</>}</div>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">※最低1枚は内観写真を設定してください</p>
        </FormRow>
      </Panel>

      <Panel title="サロンからの一言" plan>
        <FormRow label="メッセージ写真">{imgs.owner ? <img src={imgs.owner} alt="" className="w-24 h-20 object-cover mb-1" /> : <div className="w-24 h-20 bg-gray-100 mb-1" />}<button disabled={uploading} onClick={() => pickImg('owner')} className="px-2 py-0.5 bg-sky-500 text-white text-[10px] rounded disabled:opacity-50">アップロード</button> <button onClick={() => setImgs((m) => ({ ...m, owner: '' }))} className="px-2 py-0.5 bg-gray-200 text-gray-600 text-[10px] rounded">削除</button></FormRow>
        <FormRow label="氏名"><CharInput max={20} placeholder="氏名" w="w-60" defaultValue={fields.current.owner_name} onValueChange={(v) => { fields.current.owner_name = v; }} /></FormRow>
        <FormRow label="肩書き"><CharInput max={25} placeholder="肩書き" w="w-72" defaultValue={fields.current.owner_title} onValueChange={(v) => { fields.current.owner_title = v; }} /></FormRow>
        <FormRow label="メッセージ"><CharTextarea max={180} rows={3} placeholder="メッセージ" defaultValue={fields.current.owner_message} onValueChange={(v) => { fields.current.owner_message = v; }} /></FormRow>
      </Panel>

      <Panel title="サロンの雰囲気・メニューなど" plan>
        <div className="px-3 py-2 bg-amber-50/50 border-b border-slate-200 text-xs text-gray-600">雰囲気写真・メニューなど ／ キャプション</div>
        <div className="flex flex-wrap gap-4 p-3 items-start">
          <SalonPhotoGrid photos={atmosPhotos} withCaption slotClass="w-44" onReload={onReloadPhotos} onToast={onToast} />
          <div className="w-44 h-28 border border-gray-300 bg-sky-50 flex items-center justify-center text-[11px] text-sky-600 cursor-pointer" onClick={() => !uploading && pickImg('atmos')}>{uploading ? 'アップロード中…' : <>雰囲気写真を<br />アップロードする</>}</div>
        </div>
      </Panel>

      <Panel title="サロン情報" plan>
        <FormRow label="お店ロゴ">{imgs.logo ? <img src={imgs.logo} alt="" className="w-24 h-20 object-cover mb-1" /> : <div className="w-24 h-20 bg-gray-100 mb-1" />}<button disabled={uploading} onClick={() => pickImg('logo')} className="px-2 py-0.5 bg-sky-500 text-white text-[10px] rounded disabled:opacity-50">アップロード</button> <button onClick={() => setImgs((m) => ({ ...m, logo: '' }))} className="px-2 py-0.5 bg-gray-200 text-gray-600 text-[10px] rounded">削除</button></FormRow>
        <FormRow label="アクセス" required><CharInput max={40} placeholder="最寄駅からのアクセス" below defaultValue={fields.current.access_info} onValueChange={(v) => { fields.current.access_info = v; }} /></FormRow>
        <FormRow label="道案内・アクセス"><CharTextarea max={200} rows={3} placeholder="道案内" defaultValue={fields.current.directions} onValueChange={(v) => { fields.current.directions = v; }} /></FormRow>
        <FormRow label="営業時間" required><CharTextarea max={100} rows={2} placeholder="9:00〜19:00" defaultValue={fields.current.business_hours_text} onValueChange={(v) => { fields.current.business_hours_text = v; }} /></FormRow>
        <FormRow label="定休日" required><CharInput max={50} placeholder="日曜日・年末年始" below defaultValue={fields.current.regular_holiday} onValueChange={(v) => { fields.current.regular_holiday = v; }} /></FormRow>
        <FormRow label="支払い方法">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">{['Visa', 'Mastercard', 'JCB', 'American Express', 'Diners Club', 'UnionPay（銀聯）', 'Discover'].map((c) => <span key={c} className="whitespace-nowrap"><Feat label={c} /></span>)}</div>
          <label className="flex items-center gap-1 text-xs mt-1"><input type="checkbox" defaultChecked={!!fields.current.payment_other} />その他</label>
          <div className="mt-1"><CharInput max={40} placeholder="PayPay・auPAY・LINEPay・d払い・メルPay 等" below defaultValue={fields.current.payment_other} onValueChange={(v) => { fields.current.payment_other = v; }} /></div>
        </FormRow>
        <FormRow label="設備">
          <div className="flex gap-8">
            <div>
              <div className="flex items-center gap-2 text-xs mb-1">総数<input className={`${input} w-12`} defaultValue={counts.current.seat} onChange={(e) => { counts.current.seat = e.target.value.replace(/[^0-9]/g, ''); }} /></div>
              {Array.from({ length: equipCount }, (_, n) => n).map((n) => { if (!equip.current[n]) equip.current[n] = { name: '', count: '' }; return <div key={n} className="flex items-center gap-1 mb-1"><span className="text-xs text-gray-500 w-4">{n + 1}</span><select className={`${input} w-40 bg-white`} defaultValue={equip.current[n].name || ''} onChange={(e) => { equip.current[n].name = e.target.value; }}><option value="">未選択</option><option>リクライニングチェア</option><option>シャンプー台</option><option>個室</option>{equip.current[n].name && !['リクライニングチェア', 'シャンプー台', '個室'].includes(equip.current[n].name) && <option value={equip.current[n].name}>{equip.current[n].name}</option>}</select><input className={`${input} w-12`} placeholder="数" defaultValue={equip.current[n].count} onChange={(e) => { equip.current[n].count = e.target.value.replace(/[^0-9]/g, ''); }} /></div>; })}
              <button onClick={() => { equip.current.push({ name: '', count: '' }); setEquipCount((c) => c + 1); }} className="text-sky-600 underline text-xs">追加する</button>
            </div>
            <div>
              <div className="text-xs font-bold text-gray-600 mb-1">スタッフ数</div>
              <div className="flex items-center gap-2 text-xs mb-1">総数<input className={`${input} w-12`} defaultValue={counts.current.staff} onChange={(e) => { counts.current.staff = e.target.value.replace(/[^0-9]/g, ''); }} /> 人</div>
              {Array.from({ length: staffCount }, (_, n) => n).map((n) => { if (!staffRows.current[n]) staffRows.current[n] = { role: '', count: '' }; return <div key={n} className="flex items-center gap-1 mb-1"><span className="text-xs text-gray-500 w-4">{n + 1}</span><select className={`${input} w-36 bg-white`} defaultValue={staffRows.current[n].role || ''} onChange={(e) => { staffRows.current[n].role = e.target.value; }}><option value="">未選択</option><option>施術者（まつげ）</option><option>施術者（眉）</option><option>施術者（エステ）</option><option>受付</option>{staffRows.current[n].role && !['施術者（まつげ）', '施術者（眉）', '施術者（エステ）', '受付'].includes(staffRows.current[n].role) && <option value={staffRows.current[n].role}>{staffRows.current[n].role}</option>}</select><input className={`${input} w-12`} placeholder="数" defaultValue={staffRows.current[n].count} onChange={(e) => { staffRows.current[n].count = e.target.value.replace(/[^0-9]/g, ''); }} /><span className="text-xs">人</span></div>; })}
              <button onClick={() => { staffRows.current.push({ role: '', count: '' }); setStaffCount((c) => c + 1); }} className="text-sky-600 underline text-xs">追加する</button>
            </div>
          </div>
        </FormRow>
        <FormRow label="駐車場"><CharInput max={20} placeholder="提携駐車場あり 等" below defaultValue={fields.current.parking_text} onValueChange={(v) => { fields.current.parking_text = v; }} /></FormRow>
        <FormRow label="備考"><CharTextarea max={100} rows={3} placeholder="備考" defaultValue={fields.current.remarks} onValueChange={(v) => { fields.current.remarks = v; }} /></FormRow>
      </Panel>

      <Panel title="お店情報" plan>
        <FormRow label="ジャンル" required>
          <div className="space-y-1">{[1, 2, 3, 4, 5, 6].map((n) => <div key={n} className="flex items-center gap-2"><span className="text-xs text-gray-500 w-4">{n}</span><select className={`${input} w-56 bg-white`} defaultValue={genres.current[n - 1] || '未選択'} onChange={(e) => { genres.current[n - 1] = e.target.value; }}><option>未選択</option><option>まつげ・メイクなど</option><option>エステ</option></select></div>)}</div>
        </FormRow>
        <FormRow label="男性施術者区分"><div className="flex gap-4 text-xs">{['男性施術者のみ', '男性施術者もいる', '表示なし'].map((o) => <label key={o} className="flex items-center gap-1"><input type="radio" name="male" defaultChecked={o === '表示なし'} />{o}</label>)}</div></FormRow>
      </Panel>

      <Panel title="メンズにもオススメ表示・メンズ用切替設定">
        <FormRow label="メンズ"><div className="text-xs"><Feat label="メンズ利用OK" /></div><p className="text-[11px] text-gray-400 mt-1">※メンズ向け特集に参画されている場合は、設定内容に関わらずサロンデータに「メンズにもオススメ」と表示されます。</p></FormRow>
      </Panel>

      <Panel title="こだわり条件(サロンデータ)">
        <FormRow label="こだわり条件">
          <div className="grid grid-cols-3 gap-1 text-xs">{['夜20時以降も受付OK', '当日受付OK', '2名以上の利用OK', '女性専用', '個室あり', '駐車場あり', '駅から徒歩5分以内', '2回目以降特典あり', '店頭でのカード支払いOK'].map((o) => <Feat key={o} label={o} />)}</div>
        </FormRow>
        <FormRow label="サロン設備・サービス">
          <div className="grid grid-cols-3 gap-1 text-xs">{['24時間営業', '始発まで営業している', '朝10時前でも受付OK', '年中無休', '女性スタッフ在籍', '完全予約制', '指名予約OK', '1人で貸切OK', 'ショッピングモール内にある', 'ドリンクサービスあり', 'DVDが視聴できる', '喫煙OK', 'お子さま同伴可', 'キッズスペースあり', 'リクライニングチェア（ベッド）', 'メイクルームあり', '着替えあり', 'アメニティまたはコスメが充実', '3席（ベッド）以下の小型サロン', '10席（ベッド）以上の大型サロン', 'つけ放題メニューあり', '都度払いメニューあり', '体験メニューあり', 'ブライダルメニューあり', '回数券あり', 'スクール併設', 'COIN+支払いOK'].map((o) => <Feat key={o} label={o} />)}</div>
        </FormRow>
      </Panel>

      <Panel title="こだわり条件(メニュー)">
        <FormRow label="まつげ・メイクなど">
          <div className="grid grid-cols-3 gap-1 text-xs">{['まつげメニュー（要美容師免許※1）', 'ヘアセット', 'メイク', '着付け', '眉カット（要美容師免許※1）', 'シェービング（要理容師免許※1）', 'ネイル同時施術OK'].map((o) => <Feat key={o} label={o} />)}</div>
        </FormRow>
        <FormRow label="エステ（フェイシャル）">
          <div className="grid grid-cols-3 gap-1 text-xs">{['毛穴ケア', '小顔・リフトアップ', 'はり・つや', '美白ケア', '乾燥肌・保湿ケア', '黒ずみ・くすみ', 'シェービング（要理容師免許※1）'].map((o) => <Feat key={o} label={o} />)}</div>
        </FormRow>
        <FormRow label="エステ（脱毛）">
          <div className="grid grid-cols-3 gap-1 text-xs">{['ワキ', '腕（ヒジ上・ヒジ下）', '脚（ヒザ上・ヒザ下）', 'V・I・Oライン', '全身', 'その他（顔・指・胸・背中など）'].map((o) => <Feat key={o} label={o} />)}</div>
        </FormRow>
        <FormRow label="エステ（ボディ）">
          <div className="grid grid-cols-3 gap-1 text-xs">{['痩身', '美脚（太もも・ふくらはぎ・足首）', '小尻・ヒップアップ', '二の腕', '背中', 'ウエスト', 'バスト', 'シェービング（要理容師免許※1）', '美肌ケア', '耳つぼ', 'ボディトレーニング'].map((o) => <Feat key={o} label={o} />)}</div>
          <p className="text-[11px] text-gray-400 mt-2">※1 資格が必要な施術を掲載する際は、理美容業のジャンル申請を行わなければ登録できません。ジャンル申請の追加については営業担当にお問い合わせください。</p>
        </FormRow>
      </Panel>

      <Panel title="掲載情報表示の自動最適化">
        <FormRow label="自動最適化"><label className="flex items-center gap-1 text-xs"><input type="checkbox" defaultChecked />掲載情報表示を自動で最適化する</label><p className="text-[11px] text-gray-400 mt-1">※チェックを入れると、クーポンやサロン画像をはじめとした掲載情報がお客様1人ひとりの嗜好性に合うように自動で優先的に表示されます。</p></FormRow>
      </Panel>

      <SaveBar />
      <p className="text-[11px] text-gray-400">対象サロン：{salonName}</p>
    </div>
  );
}

/* ========================= スタッフ掲載情報一覧 ========================= */
function StaffListPage({ rows, facilityId, onReload, onToast }: { rows: StaffRow[]; facilityId: string; onReload: () => void; onToast: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const toggleActive = async (s: StaffRow) => {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/admin/staff/${s.id}?facility_id=${facilityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !s.is_active }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '更新に失敗しました'); return; }
      onToast(s.is_active ? '非掲載にしました' : '掲載しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setBusy(false); }
  };
  const remove = async (s: StaffRow) => {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/admin/staff/${s.id}?facility_id=${facilityId}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '削除に失敗しました'); return; }
      onToast('スタッフを削除しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-5xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">スタッフ掲載情報一覧</h2>
      <div className="flex items-center gap-3">
        <button onClick={() => onToast('新規追加は準備中です')} className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded">新規追加</button>
        <p className="text-[11px] text-gray-500">※スタッフを非掲載にした場合、該当のスタッフが投稿したブログも一緒に非掲載となります。</p>
        <button onClick={() => onToast('登録しました（デモ）')} className="ml-auto px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded">変更内容を登録する</button>
      </div>
      <div className="bg-white border border-slate-300 rounded overflow-hidden">
        <div className="bg-gradient-to-b from-sky-100 to-sky-200 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-gray-700">スタッフ一覧</span>
          <PlanBadge />
        </div>
        <table className="w-full text-sm">
          <thead><tr className="bg-amber-50 text-gray-600 text-xs">
            <th className="border border-slate-200 px-2 py-1.5 font-bold">順番</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">PickUp</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">スタッフ<br />写真</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">氏名/職種/施術歴/チェック<br />キャッチ</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">詳細</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">非掲載<br />削除</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">スタッフが登録されていません</td></tr>
            ) : rows.map((s, i) => (
              <tr key={s.id} className="text-center align-top">
                <td className="border border-slate-200 px-2 py-3"><span className="inline-flex items-center gap-1">No<input className="w-8 border border-gray-300 rounded text-center" defaultValue={i + 1} /></span></td>
                <td className="border border-slate-200 px-2 py-3"><input type="checkbox" defaultChecked={s.is_active} /></td>
                <td className="border border-slate-200 px-2 py-3">{s.photo_url ? <img src={s.photo_url} alt={s.name} className="w-12 h-14 object-cover mx-auto" /> : <div className="w-12 h-14 bg-gray-100 mx-auto" />}</td>
                <td className="border border-slate-200 px-2 py-3 text-left text-xs">
                  <div className="flex items-start gap-4">
                    <div className="font-bold w-24 shrink-0">{s.name}</div>
                    <div className="text-gray-500 flex-1">{s.position ?? '—'}</div>
                    <div className="text-gray-500 w-12">{s.years_experience != null ? `${s.years_experience}年` : '—'}</div>
                    <div className="text-emerald-600 w-8">OK</div>
                  </div>
                  <div className="mt-1 pt-1 border-t border-dashed border-slate-200 text-gray-600">{s.bio || '—'}</div>
                </td>
                <td className="border border-slate-200 px-2 py-3"><button onClick={() => onToast('詳細は準備中です')} className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs">詳細</button></td>
                <td className="border border-slate-200 px-2 py-3 space-y-1">
                  <button disabled={busy} onClick={() => toggleActive(s)} className="block w-full px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs disabled:opacity-40">{s.is_active ? '非掲載にする' : '掲載にする'}</button>
                  <button disabled={busy} onClick={() => { if (confirm('このスタッフを削除しますか？')) remove(s); }} className="block w-full px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs disabled:opacity-40">削除する</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end"><button onClick={() => onToast('登録しました（デモ）')} className="px-4 py-1.5 bg-sky-500 text-white text-xs font-bold rounded">変更内容を登録する</button></div>
    </div>
  );
}

/* ========================= フォトギャラリー掲載情報編集 ========================= */
function PhotoEditPage({ rows, coupons, facilityId, onReload, onToast }: { rows: PhotoRow[]; coupons: CouponRow[]; facilityId: string; onReload: () => void; onToast: (m: string) => void }) {
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
  const extOn = rows.length > 0 && 'genre' in (rows[0] as object);
  const draftOf = (p: PhotoRow): PhotoDraft => ({ title: p.title ?? '', caption: p.caption ?? '', genre: p.genre ?? 'まつげ・メイクなど', search_category: p.search_category ?? 'その他', image_submission: p.image_submission ?? false, is_published: p.is_published ?? true, coupon_id: p.coupon_id ?? '' });
  const [drafts, setDrafts] = useState<Record<string, PhotoDraft>>(() => Object.fromEntries(rows.map((p) => [p.id, draftOf(p)])));
  // 表示順(No.)入力。sort_order があればそれ+1、無ければ表示位置+1 を初期値にする
  const [orders, setOrders] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((p, i) => [p.id, String((p.sort_order ?? i) + 1)])));
  // アップロードで写真が増えた場合、未登録 id の下書きを補完（saveAll の drafts[id] undefined クラッシュ防止）
  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const p of rows) if (!next[p.id]) { next[p.id] = draftOf(p); changed = true; }
      return changed ? next : prev;
    });
    setOrders((prev) => {
      let changed = false;
      const next = { ...prev };
      rows.forEach((p, i) => { if (!(p.id in next)) { next[p.id] = String((p.sort_order ?? i) + 1); changed = true; } });
      return changed ? next : prev;
    });
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const updD = (id: string, k: keyof PhotoDraft, v: string | boolean) => setDrafts((m) => ({ ...m, [id]: { ...m[id], [k]: v } }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<string | null>(null); // null=新規, id=差し替え

  const pickFile = (target: string | null) => { targetRef.current = target; fileRef.current?.click(); };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { onToast('JPG, PNG, WebPのみ対応しています'); return; }
    if (file.size > 5 * 1024 * 1024) { onToast('ファイルサイズは5MB以下にしてください'); return; }
    setUploading(true);
    try {
      // service-role 経由でアップロード（carelink-uploads は anon 専用ポリシーのため）
      const fd = new FormData(); fd.append('file', file);
      const upRes = await fetch(`/api/admin/photos/upload?facility_id=${facilityId}`, { method: 'POST', body: fd });
      if (!upRes.ok) { const d = await upRes.json().catch(() => ({})); onToast(d.error || '画像のアップロードに失敗しました'); setUploading(false); return; }
      const { url } = await upRes.json();
      const target = targetRef.current;
      const res = target
        ? await fetch(`/api/admin/photos/${target}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo_url: url }) })
        : await fetch(`/api/admin/photos?facility_id=${facilityId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo_url: url, photo_type: 'other' }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); setUploading(false); return; }
      onToast(target ? '画像を差し替えました' : '写真を追加しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setUploading(false); }
  };
  const saveAll = async () => {
    if (saving) return; setSaving(true);
    try {
      for (const [i, p] of rows.entries()) {
        const dr = drafts[p.id] ?? draftOf(p);
        const orderNo = parseInt(orders[p.id] ?? '', 10);
        const sortOrder = Number.isFinite(orderNo) && orderNo > 0 ? orderNo - 1 : i;
        const payload = { caption: dr.caption, sort_order: sortOrder, ...(extOn ? { title: dr.title || null, genre: dr.genre || null, search_category: dr.search_category || null, image_submission: dr.image_submission, is_published: dr.is_published, coupon_id: dr.coupon_id || null } : {}) };
        const res = await fetch(`/api/admin/photos/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); setSaving(false); return; }
      }
      onToast('写真情報を保存しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setSaving(false); }
  };
  const remove = async (p: PhotoRow) => {
    if (saving) return; setSaving(true);
    try {
      const res = await fetch(`/api/admin/photos/${p.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '削除に失敗しました'); setSaving(false); return; }
      onToast('写真を削除しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setSaving(false); }
  };
  return (
    <div className="max-w-4xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">フォトギャラリー掲載情報編集</h2>
      <p className="text-[11px] text-gray-500">※「画像応募」にチェックをすると、Hot Pepper Beautyサイトの特集/メルマガ/装飾・バナー/公式Facebookページ等に使用される対象となります <button onClick={() => onToast('使用事例は準備中です')} className="text-sky-600 underline">使用事例はこちら</button></p>
      <div className="flex justify-end gap-2"><button disabled={saving} onClick={saveAll} className="px-5 py-1.5 bg-sky-500 text-white text-sm font-bold rounded disabled:opacity-50">{saving ? '保存中…' : '登録'}</button><button onClick={onReload} className="px-5 py-1.5 bg-gray-400 text-white text-sm font-bold rounded">キャンセル</button></div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />
      <button disabled={uploading} onClick={() => pickFile(null)} className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded disabled:opacity-50">{uploading ? 'アップロード中…' : '入力欄を追加する'}</button>
      <button onClick={() => onToast('使用できる写真は準備中です')} className="block text-sky-600 underline text-xs">? 使用できる写真について</button>
      <Panel title="フォトギャラリー設定" plan>
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">写真が登録されていません</div>
        ) : rows.map((p, i) => (
          <div key={p.id} className="flex gap-3 border-b border-slate-200 last:border-0 p-3">
            <div className="shrink-0 text-center">
              <div className="text-xs font-bold text-gray-500">No.<input className="w-8 border border-gray-300 rounded text-center" value={orders[p.id] ?? String(i + 1)} onChange={(e) => setOrders((m) => ({ ...m, [p.id]: e.target.value.replace(/[^0-9]/g, '') }))} /></div>
              {p.photo_url ? <img src={p.photo_url} alt="" className="w-24 h-20 object-cover mt-1" /> : <div className="w-24 h-20 bg-gray-100 mt-1" />}
              <div className="text-[9px] text-gray-400 mt-0.5">画像ID: C{p.id.slice(0, 8).toUpperCase()}</div>
              <button disabled={uploading} onClick={() => pickFile(p.id)} className="mt-1 px-2 py-0.5 bg-sky-500 text-white text-[10px] rounded block mx-auto disabled:opacity-50">アップロード</button>
              <button disabled={saving} onClick={() => { if (confirm('この写真を削除しますか？')) remove(p); }} className="mt-0.5 px-2 py-0.5 bg-gray-200 text-gray-600 text-[10px] rounded block mx-auto disabled:opacity-40">削除</button>
              <label className="flex items-center gap-1 text-[10px] text-gray-500 mt-1 justify-center"><input type="checkbox" checked={drafts[p.id]?.image_submission ?? false} onChange={(e) => updD(p.id, 'image_submission', e.target.checked)} />画像応募</label>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2"><span className="w-20 text-xs text-gray-500 whitespace-nowrap">タイトル</span><CharInput max={15} placeholder="タイトル" defaultValue={p.title ?? ''} onValueChange={(v) => updD(p.id, 'title', v)} /><button onClick={() => updD(p.id, 'title', '')} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-[10px] whitespace-nowrap shrink-0">クリア</button></div>
              <div className="flex items-start gap-2"><span className="w-20 text-xs text-gray-500 whitespace-nowrap">キャプション</span><CharTextarea max={30} rows={2} defaultValue={p.caption ?? ''} below={false} onValueChange={(v) => updD(p.id, 'caption', v)} /></div>
              <div className="flex items-center gap-2"><span className="w-20 text-xs text-gray-500 whitespace-nowrap">ジャンル</span><select className={`${input} bg-white`} value={drafts[p.id]?.genre ?? 'まつげ・メイクなど'} onChange={(e) => updD(p.id, 'genre', e.target.value)}><option>まつげ・メイクなど</option><option>エステ</option></select>
                <span className="ml-auto flex flex-col items-start gap-1 text-xs"><label className="flex items-center gap-1"><input type="radio" name={`pub${i}`} checked={drafts[p.id]?.is_published ?? true} onChange={() => updD(p.id, 'is_published', true)} />掲載</label><label className="flex items-center gap-1"><input type="radio" name={`pub${i}`} checked={!(drafts[p.id]?.is_published ?? true)} onChange={() => updD(p.id, 'is_published', false)} />非掲載</label></span>
              </div>
              <div className="flex items-center gap-2"><span className="w-20 text-xs text-gray-500 whitespace-nowrap">検索用カテゴリ</span><select className={`${input} bg-white`} value={drafts[p.id]?.search_category ?? 'その他'} onChange={(e) => updD(p.id, 'search_category', e.target.value)}><option>その他</option><option>まつエク［こだわり素材］</option></select></div>
              <div className="flex items-center gap-2"><span className="w-20 text-xs text-gray-500 whitespace-nowrap">クーポン</span><select className={`${input} bg-white`} value={drafts[p.id]?.coupon_id ?? ''} onChange={(e) => updD(p.id, 'coupon_id', e.target.value)}><option value="">紐付けなし</option>{coupons.map((c) => <option key={c.id} value={c.id}>{c.name.slice(0, 24)}</option>)}</select></div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

/* ========================= メニュー掲載情報編集 ========================= */
interface MenuDraft { id: string; category: string; subcategory: string; search_category: string; name: string; description: string; price: string; duration: string; reservable: boolean; isPublished: boolean; showTilde: boolean; priceAsk: boolean; sortNo: string; isNew?: boolean; }
function MenuEditPage({ rows, facilityId, onReload, onToast }: { rows: MenuRow[]; facilityId: string; onReload: () => void; onToast: (m: string) => void }) {
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
  const extOn = rows.length > 0 && 'reservable' in (rows[0] as object); // 拡張カラム適用済みか
  const [items, setItems] = useState<MenuDraft[]>(() => rows.map((m, i) => ({
    id: m.id, category: m.category ?? 'まつげ・メイクなど', subcategory: m.subcategory ?? '', search_category: m.search_category ?? '',
    name: m.name, description: m.description ?? '', price: m.price != null ? String(m.price) : '', duration: m.duration_minutes != null ? String(m.duration_minutes) : '',
    reservable: m.reservable ?? true, isPublished: m.is_published ?? true, showTilde: m.price_show_tilde ?? false, priceAsk: m.price_ask ?? false,
    sortNo: String((m.sort_order ?? i) + 1),
  })));
  const addRow = () => setItems((arr) => [...arr, { id: `new-${globalThis.crypto.randomUUID()}`, category: 'まつげ・メイクなど', subcategory: '', search_category: '', name: '', description: '', price: '', duration: '', reservable: true, isPublished: true, showTilde: false, priceAsk: false, sortNo: String(arr.length + 1), isNew: true }]);
  const [saving, setSaving] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [remarksSupported, setRemarksSupported] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/admin/menu-remarks?facility_id=${facilityId}`);
      if (!res.ok) return;
      const d = await res.json().catch(() => null);
      if (!cancelled && d) { setRemarks(d.menu_remarks ?? ''); setRemarksSupported(!!d.supported); }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [facilityId]);
  const upd = (i: number, k: keyof MenuDraft, v: string | boolean) => setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, [k]: v } : it));

  const saveAll = async () => {
    if (saving) return; setSaving(true);
    try {
      if (remarksSupported) {
        const rRes = await fetch(`/api/admin/menu-remarks?facility_id=${facilityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ menu_remarks: remarks.trim() || null }) });
        if (!rRes.ok) { const d = await rRes.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); setSaving(false); return; }
      }
      for (const [i, it] of items.entries()) {
        if (!it.name.trim() || !it.category.trim()) { onToast('カテゴリとメニュー名は必須です'); setSaving(false); return; }
        const orderNo = parseInt(it.sortNo, 10);
        const sortOrder = Number.isFinite(orderNo) && orderNo > 0 ? orderNo - 1 : i;
        // 新規行は extOn に依存せず拡張フィールドを常に送る（POSTスキーマは全 optional 受理）。既存PATCHは extOn ゲート。
        const extFields = { reservable: it.reservable, is_published: it.isPublished, price_show_tilde: it.showTilde, price_ask: it.priceAsk };
        const base = { category: it.category, subcategory: it.subcategory || null, search_category: it.search_category || null, name: it.name.trim(), description: it.description.trim() || null, price: it.price ? parseInt(it.price, 10) : null, duration_minutes: it.duration ? parseInt(it.duration, 10) : null, sort_order: sortOrder };
        if (it.isNew) {
          const res = await fetch(`/api/admin/menus?facility_id=${facilityId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, ...extFields }) });
          if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); setSaving(false); return; }
          // 採番された実IDで item を確定し、再保存時の二重POSTを防ぐ
          const created = await res.json().catch(() => null);
          const newId = created?.menu?.id as string | undefined;
          if (newId) setItems((arr) => arr.map((x) => x.id === it.id ? { ...x, id: newId, isNew: false } : x));
        } else {
          const payload = { ...base, ...(extOn ? extFields : {}) };
          const res = await fetch(`/api/admin/menus/${it.id}?facility_id=${facilityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); setSaving(false); return; }
        }
      }
      onToast('メニューを保存しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setSaving(false); }
  };
  const remove = async (it: MenuDraft) => {
    if (saving) return; setSaving(true);
    try {
      const res = await fetch(`/api/admin/menus/${it.id}?facility_id=${facilityId}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '削除に失敗しました'); setSaving(false); return; }
      setItems((arr) => arr.filter((x) => x.id !== it.id));
      onToast('メニューを削除しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setSaving(false); }
  };

  return (
    <div className="max-w-4xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">メニュー掲載情報編集</h2>
      <div className="flex justify-end gap-2"><button disabled={saving} onClick={saveAll} className="px-5 py-1.5 bg-sky-500 text-white text-sm font-bold rounded disabled:opacity-50">{saving ? '保存中…' : '登録'}</button><button onClick={onReload} className="px-5 py-1.5 bg-gray-400 text-white text-sm font-bold rounded">キャンセル</button></div>
      <button onClick={addRow} className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded">＋ メニューを追加する</button>
      <Panel title="メニュー備考">
        <FormRow label="備考"><textarea className={`${input} w-full`} rows={4} maxLength={500} placeholder="メニュー全体の備考" value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!remarksSupported} /><div className="text-right"><Counter n={hpbLen(remarks)} max={500} /></div>{!remarksSupported && <p className="text-[10px] text-gray-400">※備考機能の準備中です。</p>}</FormRow>
      </Panel>
      <Panel title="メニュー設定">
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">メニューが登録されていません</div>
        ) : items.map((m, i) => (
          <div key={m.id} className="flex gap-3 border-b border-slate-200 last:border-0 p-3 text-sm">
            <div className="shrink-0 text-xs font-bold text-gray-500 w-10 text-center">No.<br /><input className="w-8 border border-gray-300 rounded text-center" value={m.sortNo} onChange={(e) => upd(i, 'sortNo', e.target.value.replace(/[^0-9]/g, ''))} /></div>
            <div className="flex-1 space-y-2">
              <div className="flex items-start gap-2"><span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">カテゴリ</span>
                <div className="space-y-1"><select className={`${input} bg-white block`} value={m.category} onChange={(e) => upd(i, 'category', e.target.value)}><option>まつげ・メイクなど</option><option>エステ</option></select><select className={`${input} bg-white block`} value={m.subcategory} onChange={(e) => upd(i, 'subcategory', e.target.value)}><option value="">その他まつげメニュー</option>{m.subcategory && <option value={m.subcategory}>{m.subcategory}</option>}</select></div>
                <span className="w-20 shrink-0 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded ml-2 whitespace-nowrap">メニュー名</span><CharInput max={40} defaultValue={m.name} onValueChange={(v) => upd(i, 'name', v)} /></div>
              <div className="flex items-start gap-2"><span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">メニュー説明</span><CharTextarea max={70} rows={2} defaultValue={m.description} below={false} onValueChange={(v) => upd(i, 'description', v)} /></div>
              <div className="flex items-center gap-2"><span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">検索用カテゴリ</span><select className={`${input} bg-white`} value={m.search_category} onChange={(e) => upd(i, 'search_category', e.target.value)}><option value="">まつげ・メイクなど：まつげデザイン・ケア</option>{m.search_category && <option value={m.search_category}>{m.search_category}</option>}</select></div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">価格（税込）</span><span className="text-xs">¥</span><input className={`${input} w-24`} value={m.price} onChange={(e) => upd(i, 'price', e.target.value.replace(/[^0-9]/g, ''))} />
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={m.showTilde} onChange={(e) => upd(i, 'showTilde', e.target.checked)} />「〜」を表示</label>
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={m.priceAsk} onChange={(e) => upd(i, 'priceAsk', e.target.checked)} />「要問い合わせ」として表示する</label>
              </div>
              <p className="text-[10px] text-gray-400 pl-24">※チェックして掲載する場合、予約不可メニューとして掲載されます。</p>
              <div className="flex items-center gap-3">
                <span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">所要目安時間</span><DurationInput defaultValue={m.duration ? parseInt(m.duration, 10) : null} onValueChange={(v) => upd(i, 'duration', v)} />
              </div>
              <div className="flex items-center gap-3"><span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">予約</span><label className="flex items-center gap-1 text-xs"><input type="radio" name={`yoyaku${i}`} checked={m.reservable} onChange={() => upd(i, 'reservable', true)} />予約可</label><label className="flex items-center gap-1 text-xs"><input type="radio" name={`yoyaku${i}`} checked={!m.reservable} onChange={() => upd(i, 'reservable', false)} />予約不可</label>
                <span className="ml-auto flex flex-col items-end gap-1 text-xs"><button disabled={saving} onClick={() => { if (confirm('このメニューを削除しますか？')) remove(m); }} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded disabled:opacity-40">削除</button><span className="flex items-center gap-3"><label className="flex items-center gap-1"><input type="radio" name={`mpub${i}`} checked={m.isPublished} onChange={() => upd(i, 'isPublished', true)} />掲載</label><label className="flex items-center gap-1"><input type="radio" name={`mpub${i}`} checked={!m.isPublished} onChange={() => upd(i, 'isPublished', false)} />非掲載</label></span></span>
              </div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

/* ========================= こだわり ========================= */
function KodawariPage() {
  return (
    <div className="max-w-4xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">こだわり掲載情報一覧</h2>
      <Panel title="こだわり掲載情報">
        <div className="px-4 py-10 text-center text-rose-500 text-sm">現在、こだわり掲載情報はありません。</div>
      </Panel>
    </div>
  );
}

/* ========================= 特集 ========================= */
function TokushuPage() {
  return (
    <div className="max-w-4xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">特集掲載情報</h2>
      <Panel title="特集掲載情報">
        <div className="px-4 py-10 text-center text-gray-400 text-sm">現在、参画中の特集はありません。</div>
      </Panel>
    </div>
  );
}

/* ========================= クーポン掲載情報一覧 ========================= */
function CouponListPage({ rows, facilityId, onReload, onToast }: { rows: CouponRow[]; facilityId: string; onReload: () => void; onToast: (m: string) => void }) {
  const [editing, setEditing] = useState<CouponRow | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((c, i) => [c.id, String((c.sort_order ?? i) + 1)])));
  useEffect(() => {
    setOrders((prev) => { const next = { ...prev }; let ch = false; rows.forEach((c, i) => { if (!(c.id in next)) { next[c.id] = String((c.sort_order ?? i) + 1); ch = true; } }); return ch ? next : prev; });
  }, [rows]);
  const saveOrder = async () => {
    if (busy) return; setBusy(true);
    try {
      for (const [i, c] of rows.entries()) {
        const n = parseInt(orders[c.id] ?? '', 10);
        const so = Number.isFinite(n) && n > 0 ? n - 1 : i;
        const res = await fetch(`/api/admin/coupons/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort_order: so }) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '並び替えに失敗しました'); setBusy(false); return; }
      }
      onToast('並び順を保存しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setBusy(false); }
  };
  const toggleActive = async (c: CouponRow) => {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/admin/coupons/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !c.is_active }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '更新に失敗しました'); return; }
      onToast(c.is_active ? '非掲載にしました' : '掲載しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setBusy(false); }
  };
  const remove = async (c: CouponRow) => {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/admin/coupons/${c.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '削除に失敗しました'); return; }
      onToast('クーポンを削除しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setBusy(false); }
  };
  if (editing) return <CouponEditPage row={editing === 'new' ? null : editing} facilityId={facilityId} onClose={() => setEditing(null)} onSaved={onReload} onToast={onToast} />;
  return (
    <div className="max-w-5xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">クーポン掲載情報一覧</h2>
      <div className="flex justify-between">
        <button onClick={() => setEditing('new')} className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded">クーポン新規追加</button>
        <button disabled={busy} onClick={saveOrder} className="px-3 py-1.5 border border-sky-400 text-sky-600 text-xs font-bold rounded disabled:opacity-40">クーポン並び替え登録</button>
      </div>
      <div className="bg-white border border-slate-300 rounded overflow-hidden">
        <div className="bg-gradient-to-b from-sky-100 to-sky-200 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-gray-700">クーポン一覧</span>
          <PlanBadge />
        </div>
        <table className="w-full text-sm">
          <thead><tr className="bg-amber-50 text-gray-600 text-xs">
            {['順番', 'クーポン写真', '種別', 'クーポン名', '有効期限', 'チェック', '詳細', '非掲載/削除'].map((h) => <th key={h} className="border border-slate-200 px-2 py-1.5 font-bold">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">クーポンが登録されていません</td></tr>
            ) : rows.map((c, i) => (
              <tr key={c.id} className="text-center align-middle">
                <td className="border border-slate-200 px-2 py-3">No <input className="w-8 border border-gray-300 rounded text-center" value={orders[c.id] ?? String(i + 1)} onChange={(e) => setOrders((m) => ({ ...m, [c.id]: e.target.value.replace(/[^0-9]/g, '') }))} /></td>
                <td className="border border-slate-200 px-2 py-3">{c.image_url ? <img src={c.image_url} alt="" className="w-14 h-12 object-cover mx-auto" /> : <div className="w-14 h-12 bg-gray-100 mx-auto" />}</td>
                <td className="border border-slate-200 px-2 py-3 text-xs">{({ new_customer: '新規', repeat: '再来', limited_time: '期間限定', all: '全員' } as Record<string, string>)[c.coupon_type ?? ''] ?? '新規'}</td>
                <td className="border border-slate-200 px-2 py-3 text-left text-xs">{c.name}{c.special_price != null && <span className="ml-1 font-bold">¥{c.special_price.toLocaleString()}</span>}</td>
                <td className="border border-slate-200 px-2 py-3 text-xs">{c.valid_until ? fmtDate(c.valid_until) : 'なし'}</td>
                <td className="border border-slate-200 px-2 py-3 text-emerald-600 text-xs">OK</td>
                <td className="border border-slate-200 px-2 py-3"><button onClick={() => setEditing(c)} className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs">詳細</button></td>
                <td className="border border-slate-200 px-2 py-3 space-y-1">
                  <button disabled={busy} onClick={() => toggleActive(c)} className="block w-full px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs disabled:opacity-40">{c.is_active ? '非掲載にする' : '掲載する'}</button>
                  <button disabled={busy} onClick={() => { if (confirm('このクーポンを削除しますか？')) remove(c); }} className="block w-full px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs disabled:opacity-40">削除する</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ========================= クーポン掲載情報編集 ========================= */
function CouponEditPage({ row, facilityId, onClose, onSaved, onToast }: { row: CouponRow | null; facilityId: string; onClose: () => void; onSaved: () => void; onToast: (m: string) => void }) {
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [couponType, setCouponType] = useState(row?.coupon_type ?? 'new_customer');
  const [special, setSpecial] = useState(row?.special_price != null ? String(row.special_price) : '');
  const [noExpiry, setNoExpiry] = useState(!row?.valid_until);
  const [vy, setVy] = useState(row?.valid_until ? row.valid_until.slice(0, 4) : '');
  const [vm, setVm] = useState(row?.valid_until ? row.valid_until.slice(5, 7) : '');
  const [vd, setVd] = useState(row?.valid_until ? row.valid_until.slice(8, 10) : '');
  const [presentationTiming, setPresentationTiming] = useState(row?.presentation_timing ?? '予約時');
  const [usageCondition, setUsageCondition] = useState(row?.usage_condition ?? '');
  const [searchCat1, setSearchCat1] = useState(row?.search_category1 ?? 'まつげ・メイクなど');
  const [searchCat2, setSearchCat2] = useState(row?.search_category2 ?? 'アイブロウ');
  const [duration, setDuration] = useState(row?.duration_minutes != null ? String(row.duration_minutes) : '120');
  const [image, setImage] = useState(row?.image_url ?? '');
  const [imageSubmission, setImageSubmission] = useState(row?.image_submission ?? false);
  const [uploading, setUploading] = useState(false);
  const couponFileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  const onPickCouponImg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { onToast('JPG, PNG, WebPのみ対応しています'); return; }
    if (file.size > 5 * 1024 * 1024) { onToast('ファイルサイズは5MB以下にしてください'); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const up = await fetch(`/api/admin/photos/upload?facility_id=${facilityId}`, { method: 'POST', body: fd });
      if (!up.ok) { const d = await up.json().catch(() => ({})); onToast(d.error || '画像のアップロードに失敗しました'); return; }
      const { url } = await up.json();
      setImage(url); onToast('画像をアップロードしました（登録ボタンで保存）');
    } catch { onToast('通信エラーが発生しました'); } finally { setUploading(false); }
  };

  const save = async () => {
    if (saving) return;
    if (!name.trim()) { onToast('クーポン名を入力してください'); return; }
    let valid_until: string | null = null;
    if (!noExpiry) {
      if (!vy || !vm || !vd) { onToast('有効期限を入力するか「設定しない」を選択してください'); return; }
      valid_until = `${vy.padStart(4, '0')}-${vm.padStart(2, '0')}-${vd.padStart(2, '0')}`;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        coupon_type: couponType,
        discount_type: 'special_price' as const,
        special_price: special ? parseInt(special, 10) : null,
        valid_until,
        presentation_timing: presentationTiming || null,
        usage_condition: usageCondition.trim() || null,
        search_category1: searchCat1 || null,
        search_category2: searchCat2 || null,
        duration_minutes: duration ? parseInt(duration, 10) : null,
        image_url: image || null,
        image_submission: imageSubmission,
      };
      const url = row ? `/api/admin/coupons/${row.id}` : `/api/admin/coupons?facility_id=${facilityId}`;
      const res = await fetch(url, { method: row ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); setSaving(false); return; }
      onToast(row ? 'クーポンを更新しました' : 'クーポンを登録しました');
      onSaved(); onClose();
    } catch { onToast('通信エラーが発生しました'); setSaving(false); }
  };

  const SaveBar = () => (
    <div className="flex items-center justify-end gap-2">
      <span className="text-[11px] text-rose-500 mr-auto flex items-center"><Req />必須項目</span>
      <button disabled={saving} onClick={save} className="px-6 py-1.5 bg-sky-500 text-white text-sm font-bold rounded disabled:opacity-50">{saving ? '保存中…' : '登録'}</button>
      <button onClick={onClose} className="px-6 py-1.5 bg-gray-400 text-white text-sm font-bold rounded">キャンセル</button>
    </div>
  );
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between"><h2 className="text-base font-bold text-gray-800">クーポン掲載情報編集</h2><HelpIcon onClick={() => onToast('ヘルプは準備中です')} /></div>
      <p className="text-[11px] text-gray-500">※「画像応募」にチェックをすると、Hot Pepper Beautyサイトの特集/メルマガ/装飾・バナー/公式Facebookページ等に使用される対象となります <button onClick={() => onToast('使用事例は準備中です')} className="text-sky-600 underline">使用事例はこちら</button></p>
      <SaveBar />
      <Panel title="クーポン情報">
        <FormRow label="種別" required><select className={`${input} bg-white`} value={couponType} onChange={(e) => setCouponType(e.target.value)}><option value="new_customer">新規</option><option value="repeat">再来</option><option value="limited_time">期間限定</option><option value="all">全員</option></select></FormRow>
        <FormRow label="クーポン名" required>
          <div className="flex gap-3">
            <div className="flex-1"><CharInput max={36} defaultValue={row?.name ?? ''} placeholder="クーポン名" onValueChange={setName} /></div>
            <div className="w-28 text-center">
              <input ref={couponFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPickCouponImg} />
              <div className="w-24 h-20 bg-gray-100 relative mx-auto">
                {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : null}
                {image && <button onClick={() => setImage('')} className="absolute top-0 right-0 w-4 h-4 bg-gray-500 text-white text-[10px] leading-none">×</button>}
              </div>
              <button disabled={uploading} onClick={() => couponFileRef.current?.click()} className="mt-1 px-2 py-0.5 bg-sky-500 text-white text-[10px] rounded disabled:opacity-50">{uploading ? '中…' : 'アップロード'}</button>
              <label className="flex items-center justify-center gap-0.5 text-[9px] text-gray-500 mt-0.5"><input type="checkbox" checked={imageSubmission} onChange={(e) => setImageSubmission(e.target.checked)} />画像応募</label>
            </div>
          </div>
        </FormRow>
        <FormRow label="クーポン内容" required><CharTextarea max={90} rows={3} defaultValue={row?.description ?? ''} placeholder="クーポン内容" onValueChange={setDescription} /></FormRow>
        <FormRow label="提示条件" required><select className={`${input} bg-white`} value={presentationTiming} onChange={(e) => setPresentationTiming(e.target.value)}><option value="予約時">予約時</option><option value="来店時">来店時</option></select></FormRow>
        <FormRow label="利用条件" required><CharInput max={20} defaultValue={row?.usage_condition ?? ''} placeholder="新規＆まつげパーマ/アイブロウ/マツパ/眉" below onValueChange={setUsageCondition} /></FormRow>
        <FormRow label="有効期限">
          <label className="flex items-center gap-1 text-xs"><input type="radio" name="cvalid" checked={noExpiry} onChange={() => setNoExpiry(true)} />設定しない</label>
          <label className="flex items-center gap-1 text-xs mt-1"><input type="radio" name="cvalid" checked={!noExpiry} onChange={() => setNoExpiry(false)} /><input className={`${input} w-16`} placeholder="年" value={vy} onChange={(e) => { setVy(e.target.value); setNoExpiry(false); }} />年<input className={`${input} w-12`} placeholder="月" value={vm} onChange={(e) => { setVm(e.target.value); setNoExpiry(false); }} />月<input className={`${input} w-12`} placeholder="日" value={vd} onChange={(e) => { setVd(e.target.value); setNoExpiry(false); }} />日</label>
        </FormRow>
        <FormRow label="検索用カテゴリ">
          <div className="flex gap-2"><select className={`${input} bg-white`} value={searchCat1} onChange={(e) => setSearchCat1(e.target.value)}><option value="まつげ・メイクなど">まつげ・メイクなど</option><option value="エステ">エステ</option></select><select className={`${input} bg-white`} value={searchCat2} onChange={(e) => setSearchCat2(e.target.value)}><option value="アイブロウ">アイブロウ</option><option value="まつげエクステ">まつげエクステ</option><option value="まつげパーマ">まつげパーマ</option></select></div>
          <p className="text-[11px] text-gray-400 mt-1">※サロンの掲載情報「お客様番号」のうち設定したカテゴリが反映されます</p>
        </FormRow>
        <FormRow label="メニュー指定">
          <div className="text-xs text-gray-600 mb-1">あり</div>
          <div className="flex items-center gap-2 mb-2"><span className="text-xs text-gray-500">アイコン用カテゴリ</span><button onClick={() => onToast('カテゴリ選択は準備中です')} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">カテゴリ選択</button><span className="text-xs">まつげ・メイクなど－その他まつげメニュー</span></div>
          <div className="flex items-center gap-3"><span className="text-xs text-gray-500">価格（税込）</span>¥<input className={`${input} w-24`} value={special} onChange={(e) => setSpecial(e.target.value.replace(/[^0-9]/g, ''))} /><span className="text-xs text-gray-500">所要目安時間</span><input className={`${input} w-16`} value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ''))} />分</div>
        </FormRow>
      </Panel>
      <SaveBar />
    </div>
  );
}

/* ========================= ブログ一覧 ========================= */
function BlogListPage({ rows, staff, coupons, facilityId, onReload, onToast }: { rows: BlogRow[]; staff: StaffRow[]; coupons: CouponRow[]; facilityId: string; onReload: () => void; onToast: (m: string) => void }) {
  const [editing, setEditing] = useState<BlogRow | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [filterSel, setFilterSel] = useState('all'); // 絞込みドロップダウンの選択
  const [applied, setApplied] = useState('all'); // 適用中フィルタ
  const [authorModal, setAuthorModal] = useState(false);
  const [authors, setAuthors] = useState<{ id: string; name: string }[]>([]);
  const [newAuthor, setNewAuthor] = useState('');
  const loadAuthors = useCallback(async () => {
    try { const res = await fetch(`/api/admin/blog-authors?facility_id=${facilityId}`); if (res.ok) { const d = await res.json(); setAuthors(d.authors ?? []); } } catch { /* noop */ }
  }, [facilityId]);
  // 投稿者ドロップダウン（編集フォーム）でも使うためマウント時に取得
  useEffect(() => { loadAuthors(); }, [loadAuthors]);
  const openAuthorModal = () => { setAuthorModal(true); loadAuthors(); };
  const addAuthor = async () => {
    if (!newAuthor.trim()) return;
    try {
      const res = await fetch(`/api/admin/blog-authors?facility_id=${facilityId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newAuthor.trim() }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '追加に失敗しました'); return; }
      setNewAuthor(''); onToast('投稿者を追加しました'); loadAuthors();
    } catch { onToast('通信エラーが発生しました'); }
  };
  const delAuthor = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/blog-authors/${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '削除に失敗しました'); return; }
      onToast('投稿者を削除しました'); loadAuthors();
    } catch { onToast('通信エラーが発生しました'); }
  };
  const authorName = (id?: string | null) => (id ? staff.find((s) => s.id === id)?.name ?? '—' : '—');
  // 投稿者列: 外部投稿者(author_name_id)優先 → スタッフ(author_id) → 未設定
  const authorLabel = (b: BlogRow): { kind: string; name: string } => {
    if (b.author_name_id) return { kind: '投稿者', name: authors.find((a) => a.id === b.author_name_id)?.name ?? '—' };
    if (b.author_id) return { kind: 'スタッフ', name: authorName(b.author_id) };
    return { kind: '—', name: '' };
  };
  const view = applied === 'published' ? rows.filter((b) => b.is_published) : applied === 'unpublished' ? rows.filter((b) => !b.is_published) : rows;
  const remove = async (b: BlogRow) => {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/admin/blog/${b.id}?facility_id=${facilityId}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '削除に失敗しました'); return; }
      onToast('ブログを削除しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setBusy(false); }
  };
  if (editing) return <BlogEditPage row={editing === 'new' ? null : editing} coupons={coupons} staff={staff} authors={authors} facilityId={facilityId} onClose={() => setEditing(null)} onSaved={onReload} onToast={onToast} />;
  return (
    <div className="max-w-5xl space-y-3">
      {authorModal && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setAuthorModal(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-800">投稿者 追加・編集</h3><button onClick={() => setAuthorModal(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button></div>
            <p className="text-[11px] text-gray-500 mb-2">※スタッフ登録せずに、ブログのみ投稿する投稿者を5名まで追加できます。</p>
            <div className="space-y-1 mb-3">
              {authors.length === 0 ? <p className="text-xs text-gray-400 py-2">登録された投稿者はいません</p> : authors.map((au) => (
                <div key={au.id} className="flex items-center justify-between border border-slate-200 rounded px-2 py-1"><span className="text-sm">{au.name}</span><button onClick={() => delAuthor(au.id)} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">削除</button></div>
              ))}
            </div>
            <div className="flex gap-2"><input value={newAuthor} onChange={(e) => setNewAuthor(e.target.value)} maxLength={50} placeholder="投稿者名" className="border border-gray-300 rounded px-2 py-1 text-sm flex-1" /><button disabled={authors.length >= 5} onClick={addAuthor} className="px-3 py-1 bg-sky-500 text-white text-xs font-bold rounded disabled:opacity-40">追加</button></div>
          </div>
        </div>
      )}
      <h2 className="text-base font-bold text-gray-800">ブログ一覧</h2>
      <div className="text-[11px] text-gray-500 leading-relaxed">
        <p>ブログ機能は、NRプラン以上でご利用いただけます。</p>
        <p>ブログは「掲載管理TOP」画面から「掲載変更を反映する」を押さなくても、ブログ投稿完了するとそのまま反映されます。</p>
        <p className="text-rose-500 font-bold">ブログを投稿したスタッフが非掲載の場合、ブログも一緒に非掲載になります。</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setEditing('new')} className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded">新規投稿</button>
        <button onClick={openAuthorModal} className="px-3 py-1.5 border border-sky-400 text-sky-600 text-xs font-bold rounded">投稿者追加・編集</button>
        <div className="ml-auto flex items-center gap-1"><select value={filterSel} onChange={(e) => setFilterSel(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"><option value="all">すべて</option><option value="published">掲載中</option><option value="unpublished">非掲載</option></select><button onClick={() => setApplied(filterSel)} className="px-2 py-1 bg-sky-500 text-white text-xs rounded">絞込み</button><button onClick={() => { setFilterSel('all'); setApplied('all'); }} className="px-2 py-1 border border-gray-300 text-gray-600 text-xs rounded">絞込み解除</button></div>
      </div>
      <p className="text-xs text-gray-600">該当するブログが <span className="text-rose-500 font-bold">{view.length}</span> 件あります</p>
      <div className="bg-white border border-slate-300 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-amber-50 text-gray-600 text-xs">
            <th className="border border-slate-200 px-2 py-1.5 font-bold">タイトル/カテゴリ<br />クーポン</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">画像(1枚目)</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">投稿者(最終更新者)</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">初回掲載日時(最終更新日時)/ステータス</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">詳細/削除</th>
          </tr></thead>
          <tbody>
            {view.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">ブログが登録されていません</td></tr>
            ) : view.map((b) => (
              <tr key={b.id} className="align-top">
                <td className="border border-slate-200 px-0 py-0"><div className="flex h-full"><div className="flex-1 px-2 py-3"><button onClick={() => setEditing(b)} className="text-sky-600 underline text-xs">{b.title}</button></div><div className="w-24 px-2 py-3 border-l border-slate-200 text-[10px] text-gray-500">{b.category || 'ビューティー'}</div></div></td>
                <td className="border border-slate-200 px-2 py-3 text-center">{(() => { const img = b.thumbnail_url || (Array.isArray(b.image_urls) ? b.image_urls[0] : null); return img ? <img src={img} alt="" className="w-16 h-12 object-cover mx-auto" /> : <div className="w-16 h-12 bg-gray-100 mx-auto" />; })()}</td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{(() => { const a = authorLabel(b); return <>{a.kind}{a.name && <><br /><span className="text-gray-400">({a.name})</span></>}</>; })()}</td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{fmtDate(b.published_at ?? b.created_at)}<br />{b.scheduled_at && new Date(b.scheduled_at).getTime() > Date.now() ? <span className="text-amber-600">予約掲載</span> : <span className={b.is_published ? 'text-emerald-600' : 'text-gray-400'}>{b.is_published ? '掲載中' : '非掲載'}</span>}</td>
                <td className="border border-slate-200 px-2 py-3 text-center"><button onClick={() => setEditing(b)} className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs mb-1">詳細</button><br /><button disabled={busy} onClick={() => { if (confirm('このブログを削除しますか？')) remove(b); }} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs disabled:opacity-40">削除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ========================= ブログ編集 入力 ========================= */
function BlogEditPage({ row, coupons, staff, authors, facilityId, onClose, onSaved, onToast }: { row: BlogRow | null; coupons: CouponRow[]; staff: StaffRow[]; authors: { id: string; name: string }[]; facilityId: string; onClose: () => void; onSaved: () => void; onToast: (m: string) => void }) {
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
  const [title, setTitle] = useState(row?.title ?? '');
  const [body, setBody] = useState(row?.content ?? '');
  const [couponId, setCouponId] = useState(row?.coupon_id ?? '');
  // 投稿者: スタッフ(author_id)と外部投稿者(author_name_id)を 'staff:<id>' / 'ext:<id>' で一元管理
  const [author, setAuthor] = useState(row?.author_name_id ? `ext:${row.author_name_id}` : row?.author_id ? `staff:${row.author_id}` : '');
  const [category, setCategory] = useState(row?.category ?? 'ビューティー');
  const [thumbnail, setThumbnail] = useState(row?.thumbnail_url ?? '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // 予約掲載(#34): row.scheduled_at(UTC) → JST の datetime-local 文字列に変換して初期表示
  const [scheduleOn, setScheduleOn] = useState(!!row?.scheduled_at);
  const [scheduleAt, setScheduleAt] = useState(() => {
    if (!row?.scheduled_at) return '';
    const d = new Date(new Date(row.scheduled_at).getTime() + 9 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  });
  const [images, setImages] = useState<string[]>(row?.image_urls ?? []); // 本文画像（最大4枚 #33）
  const fileRef = useRef<HTMLInputElement>(null);
  const lineCount = body ? body.split('\n').length : 0;
  // 1枚目はサムネイル、2枚目以降は本文画像(image_urls)。合計4枚まで。
  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const total = (thumbnail ? 1 : 0) + images.length;
    if (total >= 4) { onToast('画像は4枚までです'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/admin/photos/upload?facility_id=${facilityId}`, { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) { onToast(d.error || '画像のアップロードに失敗しました'); return; }
      if (!thumbnail) setThumbnail(d.url); else setImages((arr) => [...arr, d.url]);
      onToast('画像をアップロードしました');
    } catch { onToast('通信エラーが発生しました'); } finally { setUploading(false); }
  };
  const save = async () => {
    if (saving) return;
    if (!title.trim()) { onToast('タイトルを入力してください'); return; }
    if (!body.trim()) { onToast('本文を入力してください'); return; }
    if (scheduleOn && !scheduleAt) { onToast('予約掲載日時を入力してください'); return; }
    setSaving(true);
    try {
      // is_published は一覧画面のトグルで管理する。編集フォームから送ると PATCH 側で published_at が
      // 現在時刻に上書きされ「初回掲載日」がずれるため、ここでは送らない（新規は POST 側で false 既定）。
      const author_id = author.startsWith('staff:') ? author.slice(6) : null;
      const author_name_id = author.startsWith('ext:') ? author.slice(4) : null;
      // 予約掲載: datetime-local 入力を JST(+09:00)として ISO(UTC) 化。OFF時は null で予約解除
      const scheduled_at = scheduleOn && scheduleAt ? new Date(`${scheduleAt}:00+09:00`).toISOString() : null;
      const payload = { title: title.trim(), content: body.trim(), coupon_id: couponId || null, author_id, author_name_id, thumbnail_url: thumbnail || null, category: category || null, scheduled_at, image_urls: images };
      const url = row ? `/api/admin/blog/${row.id}?facility_id=${facilityId}` : `/api/admin/blog?facility_id=${facilityId}`;
      const res = await fetch(url, { method: row ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); setSaving(false); return; }
      onToast(row ? 'ブログを更新しました' : 'ブログを投稿しました');
      onSaved(); onClose();
    } catch { onToast('通信エラーが発生しました'); setSaving(false); }
  };
  return (
    <div className="max-w-4xl space-y-4">
      <h2 className="text-base font-bold text-gray-800">ブログ編集 入力</h2>
      <p className="text-[11px] text-gray-500">ブログ機能は、NRプラン以上ご利用いただけます。</p>
      <div className="bg-white border border-slate-300 rounded overflow-hidden">
        <FormRow label="ステータス"><span className="text-sm">{row?.is_published ? '反映済み' : '未反映'}</span> <span className="text-[11px] text-gray-400">（ステータスは一覧の画面で変更可能です）</span></FormRow>
        <FormRow label="初回掲載日"><span className="text-sm">{row ? fmtDate(row.published_at ?? row.created_at) : fmtDate(new Date().toISOString())}</span></FormRow>
        <FormRow label="投稿者"><select value={author} onChange={(e) => setAuthor(e.target.value)} className={`${input} bg-white`}><option value="">指定なし</option>{staff.length > 0 && <optgroup label="スタッフ">{staff.map((s) => <option key={s.id} value={`staff:${s.id}`}>{s.name}</option>)}</optgroup>}{authors.length > 0 && <optgroup label="投稿者（スタッフ外）">{authors.map((a) => <option key={a.id} value={`ext:${a.id}`}>{a.name}</option>)}</optgroup>}</select> <button onClick={() => onToast('投稿者の追加・編集は一覧画面の「投稿者追加・編集」から行えます')} className="px-2 py-0.5 border border-sky-400 text-sky-600 rounded text-xs">投稿者追加・編集</button><p className="text-[11px] text-gray-400 mt-1">※スタッフ登録せずに、ブログのみ投稿する投稿者を5名まで追加できます。</p></FormRow>
        <FormRow label="カテゴリ"><select className={`${input} bg-white`} value={category} onChange={(e) => setCategory(e.target.value)}><option value="ビューティー">ビューティー</option><option value="ヘア">ヘア</option><option value="ネイル">ネイル</option><option value="メイク">メイク</option><option value="エステ">エステ</option><option value="その他">その他</option></select></FormRow>
        <FormRow label="予約掲載">
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />指定日時に自動で掲載する</label>
          {scheduleOn && <div className="mt-1"><input type="datetime-local" className={`${input}`} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} /></div>}
          <p className="text-[11px] text-gray-400 mt-1">※指定した日時（JST）になると公開ページに自動掲載されます。それまでは非表示です。</p>
        </FormRow>
        <FormRow label="タイトル"><CharInput max={25} defaultValue={row?.title ?? ''} placeholder="タイトル" onValueChange={setTitle} /><p className="text-[11px] text-gray-400">※全角25文字以下</p></FormRow>
        <FormRow label="本文">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPickImage} />
          <button disabled={uploading || ((thumbnail ? 1 : 0) + images.length) >= 4} onClick={() => fileRef.current?.click()} className="px-2 py-0.5 bg-sky-500 text-white text-xs rounded mb-1 disabled:opacity-50">{uploading ? 'アップロード中…' : '画像アップロード'}</button> <span className="text-[11px] text-gray-400">※画像は4枚までアップロードできます。</span>
          <div className="flex flex-wrap gap-2 mb-1">
            {thumbnail && <div className="relative"><img src={thumbnail} alt="サムネイル" className="h-20 rounded border border-gray-200" /><span className="absolute bottom-0 left-0 bg-sky-600 text-white text-[8px] px-1">サムネ</span><button onClick={() => setThumbnail('')} className="absolute top-0 right-0 w-4 h-4 bg-gray-600 text-white text-[10px] leading-none rounded-bl">×</button></div>}
            {images.map((u, i) => <div key={`${u}-${i}`} className="relative"><img src={u} alt="" className="h-20 rounded border border-gray-200" /><button onClick={() => setImages((arr) => arr.filter((_, idx) => idx !== i))} className="absolute top-0 right-0 w-4 h-4 bg-gray-600 text-white text-[10px] leading-none rounded-bl">×</button></div>)}
          </div>
          <div className="flex items-start gap-2">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={1000} placeholder="本文" className={`${input} flex-1`} />
            <div className="flex flex-col gap-3 text-[10px] text-gray-400 shrink-0">
              <span>{hpbLen(body)}<br />/1000</span>
              <span>{lineCount}<br />/80</span>
              <span>{(thumbnail ? 1 : 0) + images.length}<br />/4</span>
            </div>
          </div>
        </FormRow>
        <FormRow label="クーポン"><select className={`${input} bg-white`} value={couponId} onChange={(e) => setCouponId(e.target.value)}><option value="">紐付けなし</option>{coupons.map((c) => <option key={c.id} value={c.id}>{c.name.slice(0, 30)}</option>)}</select><p className="text-[11px] text-rose-500 mt-1">※クーポンの有効期限・受付期間がブログ公開時に終了していないかご確認の上、投稿（予約掲載含む）してください。</p></FormRow>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button disabled={saving} onClick={save} className="px-6 py-1.5 bg-sky-500 text-white text-sm font-bold rounded disabled:opacity-50">{saving ? '保存中…' : '登録'}</button>
        <button onClick={onClose} className="px-6 py-1.5 bg-gray-400 text-white text-sm font-bold rounded">キャンセル</button>
      </div>
    </div>
  );
}

/* ========================= 口コミ一覧 ========================= */
function ReviewListPage({ rows, staff, facilityId, onReload, onToast }: { rows: ReviewRow[]; staff: StaffRow[]; facilityId: string; onReload: () => void; onToast: (m: string) => void }) {
  const staffName = (id?: string | null) => (id ? staff.find((s) => s.id === id)?.name ?? '—' : '—');
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'replied' | 'unreplied'>('all');
  const [page, setPage] = useState(1);
  void facilityId;
  const PER = 10;
  const filtered = rows.filter((r) => filter === 'replied' ? !!r.reply : filter === 'unreplied' ? !r.reply : true);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER));
  const curPage = Math.min(page, totalPages);
  const view = filtered.slice((curPage - 1) * PER, curPage * PER);
  const openReply = (r: ReviewRow) => { setReplyId(r.id); setReplyText(r.reply ?? ''); };
  // Pick Up（注目口コミ）: 対象を true にし、既存の Pick Up を false に戻す（サロン1件運用）
  const setPickup = async (r: ReviewRow) => {
    if (saving || r.is_pickup) return; setSaving(true);
    try {
      const prev = rows.find((x) => x.is_pickup && x.id !== r.id);
      const res = await fetch(`/api/admin/reviews/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_pickup: true }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '更新に失敗しました'); setSaving(false); return; }
      if (prev) {
        const r2 = await fetch(`/api/admin/reviews/${prev.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_pickup: false }) });
        if (!r2.ok) { const d = await r2.json().catch(() => ({})); onToast(d.error || '更新に失敗しました'); setSaving(false); return; }
      }
      onToast('Pick Up を設定しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setSaving(false); }
  };
  // 審査状況ラベル（status: published=審査OK / hidden=非掲載）
  const reviewStatusLabel = (r: ReviewRow) => (r.status === 'hidden' ? { text: '非掲載', cls: 'text-gray-400' } : { text: '審査OK(掲載中)', cls: 'text-emerald-600' });
  const sendReply = async (id: string) => {
    if (saving) return;
    if (!replyText.trim()) { onToast('返信内容を入力してください'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/reviews/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reply: replyText.trim() }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '返信に失敗しました'); setSaving(false); return; }
      onToast('返信を送信しました'); setReplyId(null); setReplyText(''); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setSaving(false); }
  };
  return (
    <div className="max-w-5xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">口コミ一覧</h2>
      <p className="text-[11px] text-gray-500">HOT PEPPER Beauty予約に対して投稿された、お客様からの口コミの確認・返信ができます。</p>
      <div className="flex flex-wrap gap-6 text-xs">
        <div><div className="text-sky-700 font-bold mb-1">■ 口コミ表示切替</div><select value={filter} onChange={(e) => { setFilter(e.target.value as 'all' | 'replied' | 'unreplied'); setPage(1); }} className="border border-gray-300 rounded px-2 py-1 bg-white"><option value="all">すべての口コミ</option><option value="replied">返信済みの口コミ</option><option value="unreplied">未返信の口コミ</option></select></div>
        <div><div className="text-sky-700 font-bold mb-1">■ 口コミお役立ち情報</div><button onClick={() => onToast('準備中です')} className="text-sky-600 underline">▸ GOOD返信事例集を見る</button></div>
        <div><div className="text-sky-700 font-bold mb-1">■ 口コミの掟</div><button onClick={() => onToast('準備中です')} className="text-sky-600 underline">▸ 口コミの掟を見る</button></div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-600">該当する口コミが <span className="text-rose-500 font-bold">{filtered.length}</span> 件あります</p>
        <div className="flex items-center gap-2 text-xs">
          <button disabled={curPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-2 py-0.5 border border-gray-300 rounded text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed">◀前へ</button>
          <span>{curPage}/{totalPages}ページ</span>
          <button disabled={curPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="px-2 py-0.5 border border-gray-300 rounded text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed">次へ▶</button>
        </div>
      </div>
      <div className="bg-white border border-slate-300 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-amber-50 text-gray-600 text-xs">
            <th className="border border-slate-200 px-2 py-1.5 font-bold">ピックアップ</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">管理番号</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">口コミ<br />投稿日時</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">来店日</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">予約者名<br />(お客様番号)</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">担当スタッフ</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">本文</th>
            <th className="border border-slate-200 px-2 py-1.5 font-bold">返信(審査状況)</th>
          </tr></thead>
          <tbody>
            {view.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">{filter === 'all' ? '口コミが登録されていません' : '該当する口コミがありません'}</td></tr>
            ) : view.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="border border-slate-200 px-2 py-3 text-center">{r.is_pickup && <div className="inline-block px-1.5 py-0.5 mb-1 rounded bg-pink-500 text-white text-[9px] font-bold">Pick Up</div>}<br /><input type="radio" name="pickup" checked={!!r.is_pickup} disabled={saving} onChange={() => setPickup(r)} /></td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{r.id.slice(0, 8)}</td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{fmtDate(r.created_at)}</td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{r.visit_date ? fmtDate(r.visit_date) : '—'}</td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{r.reviewer_name ?? '—'}<br /><span className="text-gray-400">{r.booking_id ? `(${r.booking_id.slice(0, 5)})` : ''}</span></td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{staffName(r.staff_id)}</td>
                <td className="border border-slate-200 px-2 py-3 text-left text-xs max-w-xs">{r.comment ?? '—'}</td>
                <td className="border border-slate-200 px-2 py-3 text-center">
                  {replyId === r.id
                    ? <div className="space-y-1"><textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={3} maxLength={2000} className="border border-gray-300 rounded px-2 py-1 text-xs w-44" placeholder="返信内容" /><div className="flex gap-1 justify-center"><button disabled={saving} onClick={() => sendReply(r.id)} className="px-2 py-0.5 bg-sky-500 text-white rounded text-xs disabled:opacity-50">{saving ? '送信中…' : '送信'}</button><button onClick={() => setReplyId(null)} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">キャンセル</button></div></div>
                    : r.reply
                      ? <><button onClick={() => openReply(r)} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">返信済</button><div className={`text-[10px] mt-1 ${reviewStatusLabel(r).cls}`}>{reviewStatusLabel(r).text}</div></>
                      : <button onClick={() => openReply(r)} className="px-2 py-0.5 bg-sky-500 text-white rounded text-xs">返信する</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
