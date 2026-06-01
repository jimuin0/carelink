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
}

interface StaffRow { id: string; name: string; position: string | null; specialties: string[] | null; years_experience: number | null; photo_url: string | null; sort_order: number | null; is_active: boolean; bio: string | null; }
interface PhotoRow { id: string; photo_url: string | null; photo_type: string | null; caption: string | null; sort_order: number | null; title?: string | null; genre?: string | null; search_category?: string | null; image_submission?: boolean | null; is_published?: boolean | null; }
interface PhotoDraft { title: string; caption: string; genre: string; search_category: string; image_submission: boolean; is_published: boolean; }
interface MenuRow { id: string; category: string | null; name: string; description: string | null; price: number | null; price_note: string | null; duration_minutes: number | null; is_featured: boolean | null; subcategory?: string | null; search_category?: string | null; reservable?: boolean | null; is_published?: boolean | null; price_show_tilde?: boolean | null; price_ask?: boolean | null; }
interface CouponRow { id: string; name: string; description: string | null; coupon_type: string | null; special_price: number | null; valid_from: string | null; valid_until: string | null; is_active: boolean | null; }
interface BlogRow { id: string; title: string; is_published: boolean | null; published_at: string | null; created_at: string | null; thumbnail_url: string | null; author_id?: string | null; }
interface ReviewRow { id: string; reviewer_name: string | null; rating: number | null; comment: string | null; status: string | null; created_at: string | null; visit_date?: string | null; staff_id?: string | null; booking_id?: string | null; reply?: string | null; }

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
// 表示プラン確認の小バッジ
const PlanBadge = () => <button type="button" className="text-[10px] text-sky-600 border border-sky-300 rounded px-1.5 py-0.5 hover:bg-sky-50">表示プランを確認 ▼</button>;
// 文字数カウンタ
const Counter = ({ n, max }: { n: number; max: number }) => <span className="text-[10px] text-gray-400">{n}<br />/{max}</span>;

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return s.slice(0, 10).replace(/-/g, '/');
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

export default function ListingBoard({ facilityId, salonName, status, onToast }: Props) {
  const [tab, setTab] = useState<ListingTab>('top');
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [menus, setMenus] = useState<MenuRow[]>([]);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [blogs, setBlogs] = useState<BlogRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createBrowserSupabaseClient();
    const [st, ph, mn, cp, bl, rv] = await Promise.all([
      sb.from('staff_profiles').select('id,name,position,specialties,years_experience,photo_url,sort_order,is_active,bio').eq('facility_id', facilityId).order('sort_order', { ascending: true }),
      sb.from('facility_photos').select('id,photo_url,photo_type,caption,sort_order').eq('facility_id', facilityId).order('sort_order', { ascending: true }),
      sb.from('facility_menus').select('*').eq('facility_id', facilityId).order('sort_order', { ascending: true }),
      sb.from('coupons').select('id,name,description,coupon_type,special_price,valid_from,valid_until,is_active').eq('facility_id', facilityId).order('sort_order', { ascending: true }),
      sb.from('blog_posts').select('id,title,is_published,published_at,created_at,thumbnail_url,author_id').eq('facility_id', facilityId).order('created_at', { ascending: false }),
      sb.from('facility_reviews').select('*').eq('facility_id', facilityId).order('created_at', { ascending: false }),
    ]);
    setStaff((st.data as StaffRow[]) ?? []);
    setPhotos((ph.data as PhotoRow[]) ?? []);
    setMenus((mn.data as MenuRow[]) ?? []);
    setCoupons((cp.data as CouponRow[]) ?? []);
    setBlogs((bl.data as BlogRow[]) ?? []);
    setReviews((rv.data as ReviewRow[]) ?? []);
    setLoading(false);
  }, [facilityId]);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  // クーポンのみ軽量再取得（全画面スケルトンを出さず保存後に一覧反映）
  const reloadCoupons = useCallback(async () => {
    const sb = createBrowserSupabaseClient();
    const { data } = await sb.from('coupons').select('id,name,description,coupon_type,special_price,valid_from,valid_until,is_active').eq('facility_id', facilityId).order('sort_order', { ascending: true });
    setCoupons((data as CouponRow[]) ?? []);
  }, [facilityId]);

  const reloadMenus = useCallback(async () => {
    const sb = createBrowserSupabaseClient();
    const { data } = await sb.from('facility_menus').select('*').eq('facility_id', facilityId).order('sort_order', { ascending: true });
    setMenus((data as MenuRow[]) ?? []);
  }, [facilityId]);

  const reloadBlogs = useCallback(async () => {
    const sb = createBrowserSupabaseClient();
    const { data } = await sb.from('blog_posts').select('id,title,is_published,published_at,created_at,thumbnail_url,author_id').eq('facility_id', facilityId).order('created_at', { ascending: false });
    setBlogs((data as BlogRow[]) ?? []);
  }, [facilityId]);

  const reloadPhotos = useCallback(async () => {
    const sb = createBrowserSupabaseClient();
    const { data } = await sb.from('facility_photos').select('id,photo_url,photo_type,caption,sort_order').eq('facility_id', facilityId).order('sort_order', { ascending: true });
    setPhotos((data as PhotoRow[]) ?? []);
  }, [facilityId]);

  const reloadStaff = useCallback(async () => {
    const sb = createBrowserSupabaseClient();
    const { data } = await sb.from('staff_profiles').select('id,name,position,specialties,years_experience,photo_url,sort_order,is_active,bio').eq('facility_id', facilityId).order('sort_order', { ascending: true });
    setStaff((data as StaffRow[]) ?? []);
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
            {tab === 'top' && <TopPage salonName={salonName} statusLabel={statusLabel} counts={{ staff: staff.length, photos: photos.length, menus: menus.length, coupons: coupons.length }} onToast={onToast} />}
            {tab === 'salon' && <SalonEditPage salonName={salonName} facilityId={facilityId} onToast={onToast} />}
            {tab === 'staff' && <StaffListPage rows={staff} facilityId={facilityId} onReload={reloadStaff} onToast={onToast} />}
            {tab === 'photo' && <PhotoEditPage rows={photos} facilityId={facilityId} onReload={reloadPhotos} onToast={onToast} />}
            {tab === 'menu' && <MenuEditPage rows={menus} facilityId={facilityId} onReload={reloadMenus} onToast={onToast} />}
            {tab === 'kodawari' && <KodawariPage />}
            {tab === 'tokushu' && <TokushuPage />}
            {tab === 'coupon' && <CouponListPage rows={coupons} facilityId={facilityId} onReload={reloadCoupons} onToast={onToast} />}
            {tab === 'blog' && <BlogListPage rows={blogs} staff={staff} facilityId={facilityId} onReload={reloadBlogs} onToast={onToast} />}
            {tab === 'review' && <ReviewListPage rows={reviews} staff={staff} onToast={onToast} />}
          </>
        )}
      </div>
    </div>
  );
}

/* ========================= 掲載管理TOP ========================= */
function TopPage({ salonName, statusLabel, counts, onToast }: { salonName: string; statusLabel: string; counts: { staff: number; photos: number; menus: number; coupons: number }; onToast: (m: string) => void }) {
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
      <div className="flex items-center justify-between"><h2 className="text-base font-bold text-gray-800">掲載管理TOP</h2><HelpIcon onClick={() => onToast('ヘルプは準備中です')} /></div>

      <div>
        <SectionBar>サロンレポート</SectionBar>
        <div className="border border-t-0 border-slate-300 bg-white px-4 py-3 text-sm space-y-1.5 rounded-b">
          <p><button onClick={() => onToast('サロンレポート ダウンロード画面は準備中です')} className="text-sky-600 underline">サロンレポート ダウンロード画面<ExtIcon /></button> <span className="text-gray-500 text-xs">月ごとのレポートを作成してダウンロードすることができます。</span></p>
          <p><button onClick={() => onToast('HOT PEPPER Beauty レポートは準備中です')} className="text-sky-600 underline">HOT PEPPER Beauty レポート<ExtIcon /></button> <span className="text-gray-500 text-xs">レポート作成を待たずに概要を確認することができます。</span></p>
        </div>
      </div>

      <div>
        <SectionBar>営業が設定しているページの確認</SectionBar>
        <div className="border border-t-0 border-slate-300 bg-white px-4 py-3 text-sm rounded-b">
          <SectionBar sub>サロン基本情報</SectionBar>
          <button onClick={() => onToast('プレビューは準備中です')} className="text-sky-600 underline text-sm">プレビューを見る<ExtIcon /></button>
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
              <td className="border border-slate-200 px-3 py-2"><button onClick={() => onToast('プレビューは準備中です')} className="text-sky-600 underline">掲載中のページを見る<ExtIcon /></button></td>
            </tr></tbody>
          </table>
        </div>
      </div>

      <div>
        <SectionBar sub>反映状況とプレビュー</SectionBar>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs text-gray-600">表示するプラン：</span>
          <select className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"><option>ライト：2026/05/28〜2026/06/24</option></select>
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
                <td className="border border-slate-200 px-3 py-3"><button onClick={() => onToast(`${r.label} のプレビューは準備中です`)} className="text-sky-600 underline">{r.label}<ExtIcon /></button>{r.label2 && <><br /><button onClick={() => onToast(`${r.label2} のプレビューは準備中です`)} className="text-sky-600 underline">{r.label2}<ExtIcon /></button></>}</td>
                <td className="border border-slate-200 px-3 py-3 text-center text-xs">{r.empty ? '' : <>{r.editor}<br />({r.date})</>}</td>
                <td className="border border-slate-200 px-3 py-3 text-center">{r.empty ? <span className="text-rose-500 text-xs">現在、こだわり掲載情報はありません。</span> : r.check ? <button onClick={() => onToast('掲載チェックは準備中です')} className="text-rose-500 underline text-xs">{r.check}</button> : ''}</td>
                <td className="border border-slate-200 px-3 py-3 text-center"></td>
                <td className="border border-slate-200 px-3 py-3 text-center text-xs">
                  {r.reflect ? (<><span className="text-emerald-600 font-bold">反映済み</span><br /><button onClick={() => onToast('反映申請は準備中です')} className="mt-1 px-2 py-0.5 bg-gray-200 rounded text-gray-600">反映申請</button><br />({r.reflect.at})</>) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-gray-500 mt-3">反映までに通常15分程度かかります。システムメンテナンスなどによっては15分以上かかる場合があります。</p>
        <div className="text-right mt-2"><button onClick={() => onToast('ページ上部へ')} className="text-[11px] text-sky-600 underline">← ページのトップへ</button></div>
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

function SalonEditPage({ salonName, facilityId, onToast }: { salonName: string; facilityId: string; onToast: (m: string) => void }) {
  // 単純カラムに対応する主要項目を保存対象とする（キャッチ/コピー/アクセス/定休日）
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const fields = useRef({ catch_copy: '', description: '', access_info: '', regular_holiday: '', business_hours_text: '', directions: '', remarks: '', owner_name: '', owner_title: '', owner_message: '' });
  const website = useRef<string>(''); // 既存値を保持して保存時に消さない（settingsは未送信でnull化するため）
  const featureSet = useRef<Set<string>>(new Set()); // こだわり条件/サービス/支払い/メンズ等のチェック集約 → features配列
  const counts = useRef({ seat: '', staff: '' }); // 設備総数 → seat_count, スタッフ総数 → staff_count
  const genres = useRef<string[]>(['', '', '', '', '', '']); // ジャンル6枠
  const equip = useRef<{ name: string; count: string }[]>([{ name: '', count: '' }, { name: '', count: '' }, { name: '', count: '' }]); // 設備明細
  const staffRows = useRef<{ role: string; count: string }[]>([{ role: '', count: '' }, { role: '', count: '' }, { role: '', count: '' }]); // スタッフ数明細
  const extEnabled = useRef(false); // 拡張カラム(business_hours_text等)がDBに存在するか
  const toggleFeature = (label: string, on: boolean) => { if (on) featureSet.current.add(label); else featureSet.current.delete(label); };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = createBrowserSupabaseClient();
      // 拡張カラムを明示selectし、エラー(マイグレーション未適用)なら基本カラムのみで再取得
      let d: Record<string, unknown> = {};
      const extCols = 'catch_copy,description,access_info,regular_holiday,website_url,features,seat_count,staff_count,business_hours_text,directions,remarks,owner_name,owner_title,owner_message,genres,equipment,staff_breakdown';
      const extRes = await sb.from('facility_profiles').select(extCols).eq('id', facilityId).maybeSingle();
      if (!extRes.error) { extEnabled.current = true; d = (extRes.data as Record<string, unknown> | null) ?? {}; }
      else { extEnabled.current = false; const base = await sb.from('facility_profiles').select('catch_copy,description,access_info,regular_holiday,website_url,features,seat_count,staff_count').eq('id', facilityId).maybeSingle(); d = (base.data as Record<string, unknown> | null) ?? {}; }
      if (!cancelled) {
        const s = (k: string) => (d[k] as string) ?? '';
        fields.current = { catch_copy: s('catch_copy'), description: s('description'), access_info: s('access_info'), regular_holiday: s('regular_holiday'), business_hours_text: s('business_hours_text'), directions: s('directions'), remarks: s('remarks'), owner_name: s('owner_name'), owner_title: s('owner_title'), owner_message: s('owner_message') };
        website.current = s('website_url');
        featureSet.current = new Set(Array.isArray(d.features) ? (d.features as string[]) : []);
        counts.current = { seat: d.seat_count != null ? String(d.seat_count) : '', staff: d.staff_count != null ? String(d.staff_count) : '' };
        const g = Array.isArray(d.genres) ? (d.genres as string[]) : [];
        genres.current = [0, 1, 2, 3, 4, 5].map((i) => g[i] ?? '');
        const eq = Array.isArray(d.equipment) ? (d.equipment as { name: string; count: number }[]) : [];
        equip.current = [0, 1, 2].map((i) => ({ name: eq[i]?.name ?? '', count: eq[i]?.count != null ? String(eq[i].count) : '' }));
        const sbk = Array.isArray(d.staff_breakdown) ? (d.staff_breakdown as { role: string; count: number }[]) : [];
        staffRows.current = [0, 1, 2].map((i) => ({ role: sbk[i]?.role ?? '', count: sbk[i]?.count != null ? String(sbk[i].count) : '' }));
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
        owner_name: fields.current.owner_name, owner_title: fields.current.owner_title, owner_message: fields.current.owner_message,
        genres: genres.current.filter((x) => x && x !== '未選択'),
        equipment: equip.current.filter((e) => e.name.trim()).map((e) => ({ name: e.name.trim(), count: e.count ? parseInt(e.count, 10) : 0 })),
        staff_breakdown: staffRows.current.filter((e) => e.role.trim()).map((e) => ({ role: e.role.trim(), count: e.count ? parseInt(e.count, 10) : 0 })),
      } : {};
      const payload = { ...base, ...ext };
      const res = await fetch(`/api/admin/settings?facility_id=${facilityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); setSaving(false); return; }
      onToast('サロン掲載情報を保存しました'); setSaving(false);
    } catch { onToast('通信エラーが発生しました'); setSaving(false); }
  };
  // こだわり/サービス/支払い等のチェック（features集約・初期値プリフィル）
  const Feat = ({ label }: { label: string }) => (
    <label className="flex items-center gap-1"><input type="checkbox" defaultChecked={featureSet.current.has(label)} onChange={(e) => toggleFeature(label, e.target.checked)} />{label}</label>
  );

  const SaveBar = () => (
    <div className="flex items-center justify-end gap-2">
      <span className="text-[11px] text-rose-500 mr-auto flex items-center"><Req />必須項目</span>
      <button disabled={saving} onClick={save} className="px-6 py-1.5 bg-sky-500 text-white text-sm font-bold rounded hover:bg-sky-600 disabled:opacity-50">{saving ? '保存中…' : '登録'}</button>
      <button onClick={() => onToast('変更を取り消しました')} className="px-6 py-1.5 bg-gray-400 text-white text-sm font-bold rounded hover:bg-gray-500">キャンセル</button>
    </div>
  );
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
  if (!loaded) return <div className="max-w-4xl"><div className="animate-pulse h-40 bg-gray-200 rounded" /></div>;
  return (
    <div className="max-w-4xl space-y-4">
      <h2 className="text-base font-bold text-gray-800">サロン掲載情報編集</h2>
      <p className="text-[11px] text-gray-500">※「画像応募」にチェックをすると、Hot Pepper Beautyサイトの特集/メルマガ/装飾・バナー/公式Facebookページ等に使用される対象となります。 <button onClick={() => onToast('使用事例は準備中です')} className="text-sky-600 underline">使用事例はこちら</button></p>
      <SaveBar />

      <Panel title="デザインテンプレート設定" plan>
        <FormRow label="デザインテンプレート">
          <p className="text-xs text-gray-500 mb-2">デザインとカラーを選択して、デザインテンプレートをカスタマイズすることができます。</p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">現在の設定：</span>
            <div className="w-16 h-12 border border-gray-300 bg-gray-50" />
            <button onClick={() => onToast('デザインテンプレート設定は準備中です')} className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded">デザインテンプレートを設定する</button>
          </div>
          <button onClick={() => onToast('プレビューは準備中です')} className="text-sky-600 underline text-xs mt-2">上記の設定を適用したページを見る</button>
        </FormRow>
      </Panel>

      <Panel title="サロンヘッダー" plan>
        <FormRow label="サロンヘッダー写真">
          <div className="w-full max-w-md h-32 border-2 border-dashed border-gray-300 rounded flex items-center justify-center text-sm text-gray-400 cursor-pointer hover:bg-gray-50" onClick={() => onToast('画像アップロードは準備中です')}>画像を<br />アップロードする</div>
          <button onClick={() => onToast('使用できる写真は準備中です')} className="text-sky-600 underline text-xs mt-1">使用できる写真について</button>
        </FormRow>
      </Panel>

      <Panel title="サロントップ" plan>
        <FormRow label="キャッチ" required><CharInput max={50} placeholder="キャッチコピー" below defaultValue={fields.current.catch_copy} onValueChange={(v) => { fields.current.catch_copy = v; }} /></FormRow>
        <FormRow label="コピー" required><CharTextarea max={150} rows={3} placeholder="サロンの紹介文" defaultValue={fields.current.description} onValueChange={(v) => { fields.current.description = v; }} /></FormRow>
        <FormRow label="ＴＯＰ写真" required>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="w-24 text-center">
                <div className="w-24 h-20 bg-gray-100 relative"><button onClick={() => onToast('削除は準備中です')} className="absolute top-0 right-0 w-4 h-4 bg-gray-500 text-white text-[10px] leading-none">×</button></div>
                <div className="text-[9px] text-gray-400 mt-0.5">画像ID:C0419048{60 + i}</div>
                <label className="flex items-center justify-center gap-0.5 text-[9px] text-gray-500"><input type="checkbox" />画像応募</label>
                <div className="flex justify-center gap-1 mt-0.5 text-[9px]"><button onClick={() => onToast('準備中です')} className="px-1 bg-sky-100 text-sky-600 rounded">前へ</button><button onClick={() => onToast('準備中です')} className="px-1 bg-sky-100 text-sky-600 rounded">後ろへ</button></div>
              </div>
            ))}
            <div className="w-24 h-20 border border-gray-300 bg-sky-50 flex items-center justify-center text-[10px] text-sky-600 cursor-pointer" onClick={() => onToast('写真の追加は準備中です')}>画像を<br />アップロードする</div>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">※最低1枚は内観写真を設定してください</p>
        </FormRow>
      </Panel>

      <Panel title="サロンからの一言" plan>
        <FormRow label="メッセージ写真"><div className="w-24 h-20 bg-gray-100 mb-1" /><button onClick={() => onToast('アップロードは準備中です')} className="px-2 py-0.5 bg-sky-500 text-white text-[10px] rounded">アップロード</button> <button onClick={() => onToast('削除は準備中です')} className="px-2 py-0.5 bg-gray-200 text-gray-600 text-[10px] rounded">削除</button></FormRow>
        <FormRow label="氏名"><CharInput max={20} placeholder="氏名" w="w-60" defaultValue={fields.current.owner_name} onValueChange={(v) => { fields.current.owner_name = v; }} /></FormRow>
        <FormRow label="肩書き"><CharInput max={25} placeholder="肩書き" w="w-72" defaultValue={fields.current.owner_title} onValueChange={(v) => { fields.current.owner_title = v; }} /></FormRow>
        <FormRow label="メッセージ"><CharTextarea max={180} rows={3} placeholder="メッセージ" defaultValue={fields.current.owner_message} onValueChange={(v) => { fields.current.owner_message = v; }} /></FormRow>
      </Panel>

      <Panel title="サロンの雰囲気・メニューなど" plan>
        <div className="px-3 py-2 bg-amber-50/50 border-b border-slate-200 text-xs text-gray-600">雰囲気写真・メニューなど ／ キャプション</div>
        <div className="flex flex-wrap gap-4 p-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-44 text-center">
              <div className="w-full h-28 bg-gray-100 relative"><button onClick={() => onToast('削除は準備中です')} className="absolute top-0 right-0 w-4 h-4 bg-gray-500 text-white text-[10px] leading-none">×</button></div>
              <div className="text-[9px] text-gray-400 mt-0.5">画像ID：C0310666{36 + i}</div>
              <label className="flex items-center justify-center gap-0.5 text-[9px] text-gray-500"><input type="checkbox" />画像応募</label>
              <div className="flex items-start gap-1 mt-1"><CharTextarea max={30} rows={2} placeholder="キャプション" below={false} /></div>
              <div className="flex justify-center gap-1 mt-0.5 text-[9px]"><button onClick={() => onToast('準備中です')} className="px-1 bg-sky-100 text-sky-600 rounded">前へ</button><button onClick={() => onToast('準備中です')} className="px-1 bg-sky-100 text-sky-600 rounded">後ろへ</button></div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="サロン情報" plan>
        <FormRow label="お店ロゴ"><div className="w-24 h-20 bg-gray-100 mb-1" /><button onClick={() => onToast('アップロードは準備中です')} className="px-2 py-0.5 bg-sky-500 text-white text-[10px] rounded">アップロード</button> <button onClick={() => onToast('削除は準備中です')} className="px-2 py-0.5 bg-gray-200 text-gray-600 text-[10px] rounded">削除</button></FormRow>
        <FormRow label="アクセス" required><CharInput max={40} placeholder="最寄駅からのアクセス" below defaultValue={fields.current.access_info} onValueChange={(v) => { fields.current.access_info = v; }} /></FormRow>
        <FormRow label="道案内・アクセス"><CharTextarea max={200} rows={3} placeholder="道案内" defaultValue={fields.current.directions} onValueChange={(v) => { fields.current.directions = v; }} /></FormRow>
        <FormRow label="営業時間" required><CharTextarea max={100} rows={2} placeholder="9:00〜19:00" defaultValue={fields.current.business_hours_text} onValueChange={(v) => { fields.current.business_hours_text = v; }} /></FormRow>
        <FormRow label="定休日" required><CharInput max={50} placeholder="日曜日・年末年始" below defaultValue={fields.current.regular_holiday} onValueChange={(v) => { fields.current.regular_holiday = v; }} /></FormRow>
        <FormRow label="支払い方法">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">{['Visa', 'Mastercard', 'JCB', 'American Express', 'Diners Club', 'UnionPay（銀聯）', 'Discover'].map((c) => <span key={c} className="whitespace-nowrap"><Feat label={c} /></span>)}</div>
          <label className="flex items-center gap-1 text-xs mt-1"><input type="checkbox" />その他</label>
          <div className="mt-1"><CharInput max={40} placeholder="PayPay・auPAY・LINEPay・d払い・メルPay 等" below /></div>
        </FormRow>
        <FormRow label="設備">
          <div className="flex gap-8">
            <div>
              <div className="flex items-center gap-2 text-xs mb-1">総数<input className={`${input} w-12`} defaultValue={counts.current.seat} onChange={(e) => { counts.current.seat = e.target.value.replace(/[^0-9]/g, ''); }} /></div>
              {[0, 1, 2].map((n) => <div key={n} className="flex items-center gap-1 mb-1"><span className="text-xs text-gray-500 w-4">{n + 1}</span><select className={`${input} w-40 bg-white`} defaultValue={equip.current[n].name || ''} onChange={(e) => { equip.current[n].name = e.target.value; }}><option value="">未選択</option><option>リクライニングチェア</option><option>シャンプー台</option><option>個室</option>{equip.current[n].name && !['リクライニングチェア', 'シャンプー台', '個室'].includes(equip.current[n].name) && <option value={equip.current[n].name}>{equip.current[n].name}</option>}</select><input className={`${input} w-12`} placeholder="数" defaultValue={equip.current[n].count} onChange={(e) => { equip.current[n].count = e.target.value.replace(/[^0-9]/g, ''); }} /></div>)}
              <button onClick={() => onToast('追加は登録後に行ってください')} className="text-sky-600 underline text-xs">追加する</button>
            </div>
            <div>
              <div className="text-xs font-bold text-gray-600 mb-1">スタッフ数</div>
              <div className="flex items-center gap-2 text-xs mb-1">総数<input className={`${input} w-12`} defaultValue={counts.current.staff} onChange={(e) => { counts.current.staff = e.target.value.replace(/[^0-9]/g, ''); }} /> 人</div>
              {[0, 1, 2].map((n) => <div key={n} className="flex items-center gap-1 mb-1"><span className="text-xs text-gray-500 w-4">{n + 1}</span><select className={`${input} w-36 bg-white`} defaultValue={staffRows.current[n].role || ''} onChange={(e) => { staffRows.current[n].role = e.target.value; }}><option value="">未選択</option><option>施術者（まつげ）</option><option>施術者（眉）</option><option>施術者（エステ）</option><option>受付</option>{staffRows.current[n].role && !['施術者（まつげ）', '施術者（眉）', '施術者（エステ）', '受付'].includes(staffRows.current[n].role) && <option value={staffRows.current[n].role}>{staffRows.current[n].role}</option>}</select><input className={`${input} w-12`} placeholder="数" defaultValue={staffRows.current[n].count} onChange={(e) => { staffRows.current[n].count = e.target.value.replace(/[^0-9]/g, ''); }} /><span className="text-xs">人</span></div>)}
              <button onClick={() => onToast('追加は登録後に行ってください')} className="text-sky-600 underline text-xs">追加する</button>
            </div>
          </div>
        </FormRow>
        <FormRow label="駐車場"><CharInput max={20} placeholder="提携駐車場あり 等" below /></FormRow>
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
function PhotoEditPage({ rows, facilityId, onReload, onToast }: { rows: PhotoRow[]; facilityId: string; onReload: () => void; onToast: (m: string) => void }) {
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
  const extOn = rows.length > 0 && 'genre' in (rows[0] as object);
  const [drafts, setDrafts] = useState<Record<string, PhotoDraft>>(() => Object.fromEntries(rows.map((p) => [p.id, { title: p.title ?? '', caption: p.caption ?? '', genre: p.genre ?? 'まつげ・メイクなど', search_category: p.search_category ?? 'その他', image_submission: p.image_submission ?? false, is_published: p.is_published ?? true }])));
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
      for (const p of rows) {
        const dr = drafts[p.id];
        const payload = { caption: dr.caption, ...(extOn ? { title: dr.title || null, genre: dr.genre || null, search_category: dr.search_category || null, image_submission: dr.image_submission, is_published: dr.is_published } : {}) };
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
              <div className="text-xs font-bold text-gray-500">No.<input className="w-8 border border-gray-300 rounded text-center" defaultValue={i + 1} /></div>
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
              <div className="flex items-center gap-2"><span className="w-20 text-xs text-gray-500 whitespace-nowrap">クーポン</span><button onClick={() => onToast('クーポン選択は準備中です')} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">クーポン選択</button></div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

/* ========================= メニュー掲載情報編集 ========================= */
interface MenuDraft { id: string; category: string; subcategory: string; search_category: string; name: string; description: string; price: string; duration: string; reservable: boolean; isPublished: boolean; showTilde: boolean; priceAsk: boolean; }
function MenuEditPage({ rows, facilityId, onReload, onToast }: { rows: MenuRow[]; facilityId: string; onReload: () => void; onToast: (m: string) => void }) {
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
  const extOn = rows.length > 0 && 'reservable' in (rows[0] as object); // 拡張カラム適用済みか
  const [items, setItems] = useState<MenuDraft[]>(() => rows.map((m) => ({
    id: m.id, category: m.category ?? 'まつげ・メイクなど', subcategory: m.subcategory ?? '', search_category: m.search_category ?? '',
    name: m.name, description: m.description ?? '', price: m.price != null ? String(m.price) : '', duration: m.duration_minutes != null ? String(m.duration_minutes) : '',
    reservable: m.reservable ?? true, isPublished: m.is_published ?? true, showTilde: m.price_show_tilde ?? false, priceAsk: m.price_ask ?? false,
  })));
  const [saving, setSaving] = useState(false);
  const upd = (i: number, k: keyof MenuDraft, v: string | boolean) => setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, [k]: v } : it));

  const saveAll = async () => {
    if (saving) return; setSaving(true);
    try {
      for (const it of items) {
        if (!it.name.trim() || !it.category.trim()) { onToast('カテゴリとメニュー名は必須です'); setSaving(false); return; }
        const payload = { category: it.category, subcategory: it.subcategory || null, search_category: it.search_category || null, name: it.name.trim(), description: it.description.trim() || null, price: it.price ? parseInt(it.price, 10) : null, duration_minutes: it.duration ? parseInt(it.duration, 10) : null,
          ...(extOn ? { reservable: it.reservable, is_published: it.isPublished, price_show_tilde: it.showTilde, price_ask: it.priceAsk } : {}) };
        const res = await fetch(`/api/admin/menus/${it.id}?facility_id=${facilityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '保存に失敗しました'); setSaving(false); return; }
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
      <Panel title="メニュー備考">
        <FormRow label="備考"><textarea className={`${input} w-full`} rows={4} maxLength={500} placeholder="メニュー全体の備考" /><div className="text-right"><Counter n={0} max={500} /></div></FormRow>
      </Panel>
      <Panel title="メニュー設定">
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">メニューが登録されていません</div>
        ) : items.map((m, i) => (
          <div key={m.id} className="flex gap-3 border-b border-slate-200 last:border-0 p-3 text-sm">
            <div className="shrink-0 text-xs font-bold text-gray-500 w-10 text-center">No.<br /><input className="w-8 border border-gray-300 rounded text-center" defaultValue={i + 1} /></div>
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
        <button onClick={() => onToast('並び替え登録は準備中です')} className="px-3 py-1.5 border border-sky-400 text-sky-600 text-xs font-bold rounded">クーポン並び替え登録</button>
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
                <td className="border border-slate-200 px-2 py-3">No <input className="w-8 border border-gray-300 rounded text-center" defaultValue={i + 1} /></td>
                <td className="border border-slate-200 px-2 py-3"><div className="w-14 h-12 bg-gray-100 mx-auto" /></td>
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
  const [saving, setSaving] = useState(false);

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
            <div className="w-28 text-center"><div className="w-24 h-20 bg-gray-100 relative mx-auto"><button onClick={() => onToast('削除は準備中です')} className="absolute top-0 right-0 w-4 h-4 bg-gray-500 text-white text-[10px] leading-none">×</button></div><div className="text-[9px] text-gray-400 mt-0.5">画像ID:C043307344</div><label className="flex items-center justify-center gap-0.5 text-[9px] text-gray-500"><input type="checkbox" />画像応募</label></div>
          </div>
        </FormRow>
        <FormRow label="クーポン内容" required><CharTextarea max={90} rows={3} defaultValue={row?.description ?? ''} placeholder="クーポン内容" onValueChange={setDescription} /></FormRow>
        <FormRow label="提示条件" required><select className={`${input} bg-white`}><option>予約時</option><option>来店時</option></select></FormRow>
        <FormRow label="利用条件" required><CharInput max={20} placeholder="新規＆まつげパーマ/アイブロウ/マツパ/眉" below /></FormRow>
        <FormRow label="有効期限">
          <label className="flex items-center gap-1 text-xs"><input type="radio" name="cvalid" checked={noExpiry} onChange={() => setNoExpiry(true)} />設定しない</label>
          <label className="flex items-center gap-1 text-xs mt-1"><input type="radio" name="cvalid" checked={!noExpiry} onChange={() => setNoExpiry(false)} /><input className={`${input} w-16`} placeholder="年" value={vy} onChange={(e) => { setVy(e.target.value); setNoExpiry(false); }} />年<input className={`${input} w-12`} placeholder="月" value={vm} onChange={(e) => { setVm(e.target.value); setNoExpiry(false); }} />月<input className={`${input} w-12`} placeholder="日" value={vd} onChange={(e) => { setVd(e.target.value); setNoExpiry(false); }} />日</label>
        </FormRow>
        <FormRow label="検索用カテゴリ">
          <div className="flex gap-2"><select className={`${input} bg-white`}><option>まつげ・メイクなど</option></select><select className={`${input} bg-white`}><option>アイブロウ</option></select></div>
          <p className="text-[11px] text-gray-400 mt-1">※サロンの掲載情報「お客様番号」のうち設定したカテゴリが反映されます</p>
        </FormRow>
        <FormRow label="メニュー指定">
          <div className="text-xs text-gray-600 mb-1">あり</div>
          <div className="flex items-center gap-2 mb-2"><span className="text-xs text-gray-500">アイコン用カテゴリ</span><button onClick={() => onToast('カテゴリ選択は準備中です')} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">カテゴリ選択</button><span className="text-xs">まつげ・メイクなど－その他まつげメニュー</span></div>
          <div className="flex items-center gap-3"><span className="text-xs text-gray-500">価格（税込）</span>¥<input className={`${input} w-24`} value={special} onChange={(e) => setSpecial(e.target.value.replace(/[^0-9]/g, ''))} /><span className="text-xs text-gray-500">所要目安時間</span><input className={`${input} w-16`} defaultValue={120} />分</div>
        </FormRow>
      </Panel>
      <SaveBar />
    </div>
  );
}

/* ========================= ブログ一覧 ========================= */
function BlogListPage({ rows, staff, facilityId, onReload, onToast }: { rows: BlogRow[]; staff: StaffRow[]; facilityId: string; onReload: () => void; onToast: (m: string) => void }) {
  const [editing, setEditing] = useState<BlogRow | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const authorName = (id?: string | null) => (id ? staff.find((s) => s.id === id)?.name ?? '—' : '—');
  const remove = async (b: BlogRow) => {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/admin/blog/${b.id}?facility_id=${facilityId}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); onToast(d.error || '削除に失敗しました'); return; }
      onToast('ブログを削除しました'); onReload();
    } catch { onToast('通信エラーが発生しました'); } finally { setBusy(false); }
  };
  if (editing) return <BlogEditPage row={editing === 'new' ? null : editing} facilityId={facilityId} onClose={() => setEditing(null)} onSaved={onReload} onToast={onToast} />;
  return (
    <div className="max-w-5xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">ブログ一覧</h2>
      <div className="text-[11px] text-gray-500 leading-relaxed">
        <p>ブログ機能は、NRプラン以上でご利用いただけます。</p>
        <p>ブログは「掲載管理TOP」画面から「掲載変更を反映する」を押さなくても、ブログ投稿完了するとそのまま反映されます。</p>
        <p className="text-rose-500 font-bold">ブログを投稿したスタッフが非掲載の場合、ブログも一緒に非掲載になります。</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setEditing('new')} className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded">新規投稿</button>
        <button onClick={() => onToast('投稿者追加・編集は準備中です')} className="px-3 py-1.5 border border-sky-400 text-sky-600 text-xs font-bold rounded">投稿者追加・編集</button>
        <div className="ml-auto flex items-center gap-1"><select className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"><option></option></select><button onClick={() => onToast('絞込みは準備中です')} className="px-2 py-1 bg-sky-500 text-white text-xs rounded">絞込み</button><button onClick={() => onToast('絞込み解除は準備中です')} className="px-2 py-1 border border-gray-300 text-gray-600 text-xs rounded">絞込み解除</button></div>
      </div>
      <p className="text-xs text-gray-600">該当するブログが <span className="text-rose-500 font-bold">{rows.length}</span> 件あります</p>
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
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">ブログが登録されていません</td></tr>
            ) : rows.map((b) => (
              <tr key={b.id} className="align-top">
                <td className="border border-slate-200 px-0 py-0"><div className="flex h-full"><div className="flex-1 px-2 py-3"><button onClick={() => setEditing(b)} className="text-sky-600 underline text-xs">{b.title}</button></div><div className="w-24 px-2 py-3 border-l border-slate-200 text-[10px] text-gray-500">ビューティー</div></div></td>
                <td className="border border-slate-200 px-2 py-3 text-center">{b.thumbnail_url ? <img src={b.thumbnail_url} alt="" className="w-16 h-12 object-cover mx-auto" /> : <div className="w-16 h-12 bg-gray-100 mx-auto" />}</td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">スタッフ<br /><span className="text-gray-400">({authorName(b.author_id)})</span></td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{fmtDate(b.published_at ?? b.created_at)}<br /><span className={b.is_published ? 'text-emerald-600' : 'text-gray-400'}>{b.is_published ? '掲載中' : '非掲載'}</span></td>
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
function BlogEditPage({ row, facilityId, onClose, onSaved, onToast }: { row: BlogRow | null; facilityId: string; onClose: () => void; onSaved: () => void; onToast: (m: string) => void }) {
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
  const [title, setTitle] = useState(row?.title ?? '');
  const [body, setBody] = useState(row?.title ? 'こんにちは、パリジェンヌ・眉毛・マツエクの専門店 HALです。' : '');
  const [saving, setSaving] = useState(false);
  const lineCount = body ? body.split('\n').length : 0;
  const save = async () => {
    if (saving) return;
    if (!title.trim()) { onToast('タイトルを入力してください'); return; }
    if (!body.trim()) { onToast('本文を入力してください'); return; }
    setSaving(true);
    try {
      const payload = { title: title.trim(), content: body.trim(), is_published: !!row?.is_published };
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
        <FormRow label="投稿者"><select className={`${input} bg-white`}><option>スタッフ</option></select> <button onClick={() => onToast('投稿者追加・編集は準備中です')} className="px-2 py-0.5 border border-sky-400 text-sky-600 rounded text-xs">投稿者追加・編集</button><p className="text-[11px] text-gray-400 mt-1">※スタッフ登録せずに、ブログのみ投稿する投稿者を5名まで追加できます。</p></FormRow>
        <FormRow label="カテゴリ"><select className={`${input} bg-white`}><option>ビューティー</option></select></FormRow>
        <FormRow label="タイトル"><CharInput max={25} defaultValue={row?.title ?? ''} placeholder="タイトル" onValueChange={setTitle} /><p className="text-[11px] text-gray-400">※全角25文字以下</p></FormRow>
        <FormRow label="本文">
          <button onClick={() => onToast('画像アップロードは準備中です')} className="px-2 py-0.5 bg-sky-500 text-white text-xs rounded mb-1">画像アップロード</button> <span className="text-[11px] text-gray-400">※画像は4枚までアップロードできます。</span>
          <div className="flex items-start gap-2">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={1000} placeholder="本文" className={`${input} flex-1`} />
            <div className="flex flex-col gap-3 text-[10px] text-gray-400 shrink-0">
              <span>{hpbLen(body)}<br />/1000</span>
              <span>{lineCount}<br />/80</span>
              <span>0<br />/4</span>
            </div>
          </div>
        </FormRow>
        <FormRow label="クーポン"><button onClick={() => onToast('クーポン選択は準備中です')} className="px-2 py-0.5 bg-sky-500 text-white rounded text-xs">クーポン選択</button><p className="text-[11px] text-rose-500 mt-1">※クーポンの有効期限・受付期間がブログ公開時に終了していないかご確認の上、投稿（予約掲載含む）してください。</p></FormRow>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button disabled={saving} onClick={save} className="px-6 py-1.5 bg-sky-500 text-white text-sm font-bold rounded disabled:opacity-50">{saving ? '保存中…' : '登録'}</button>
        <button onClick={onClose} className="px-6 py-1.5 bg-gray-400 text-white text-sm font-bold rounded">キャンセル</button>
      </div>
    </div>
  );
}

/* ========================= 口コミ一覧 ========================= */
function ReviewListPage({ rows, staff, onToast }: { rows: ReviewRow[]; staff: StaffRow[]; onToast: (m: string) => void }) {
  const staffName = (id?: string | null) => (id ? staff.find((s) => s.id === id)?.name ?? '—' : '—');
  return (
    <div className="max-w-5xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">口コミ一覧</h2>
      <p className="text-[11px] text-gray-500">HOT PEPPER Beauty予約に対して投稿された、お客様からの口コミの確認・返信ができます。</p>
      <div className="flex flex-wrap gap-6 text-xs">
        <div><div className="text-sky-700 font-bold mb-1">■ 口コミ表示切替</div><select className="border border-gray-300 rounded px-2 py-1 bg-white"><option>すべての口コミ</option></select></div>
        <div><div className="text-sky-700 font-bold mb-1">■ 口コミお役立ち情報</div><button onClick={() => onToast('準備中です')} className="text-sky-600 underline">▸ GOOD返信事例集を見る</button></div>
        <div><div className="text-sky-700 font-bold mb-1">■ 口コミの掟</div><button onClick={() => onToast('準備中です')} className="text-sky-600 underline">▸ 口コミの掟を見る</button></div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-600">該当する口コミが <span className="text-rose-500 font-bold">{rows.length}</span> 件あります</p>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => onToast('準備中です')} className="px-2 py-0.5 border border-gray-300 rounded text-gray-400">◀前へ</button>
          <span>1/1ページ</span>
          <button onClick={() => onToast('準備中です')} className="px-2 py-0.5 border border-gray-300 rounded text-gray-400">次へ▶</button>
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
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">口コミが登録されていません</td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.id} className="align-top">
                <td className="border border-slate-200 px-2 py-3 text-center">{i === 0 && <div className="inline-block px-1.5 py-0.5 mb-1 rounded bg-pink-500 text-white text-[9px] font-bold">Pick Up</div>}<br /><input type="radio" name="pickup" defaultChecked={i === 0} /></td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{r.id.slice(0, 8)}</td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{fmtDate(r.created_at)}</td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{r.visit_date ? fmtDate(r.visit_date) : '—'}</td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{r.reviewer_name ?? '—'}<br /><span className="text-gray-400">{r.booking_id ? `(${r.booking_id.slice(0, 5)})` : ''}</span></td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{staffName(r.staff_id)}</td>
                <td className="border border-slate-200 px-2 py-3 text-left text-xs max-w-xs">{r.comment ?? '—'}</td>
                <td className="border border-slate-200 px-2 py-3 text-center">
                  {r.reply
                    ? <><button onClick={() => onToast('返信内容は準備中です')} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">返信済</button><div className="text-[10px] text-emerald-600 mt-1">審査OK(掲載中)</div></>
                    : <button onClick={() => onToast('返信は準備中です')} className="px-2 py-0.5 bg-sky-500 text-white rounded text-xs">返信する</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
