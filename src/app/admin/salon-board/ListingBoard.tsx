'use client';
/* eslint-disable @next/next/no-img-element -- Supabase Storage の動的URLのため next/image 非対応。掲載写真はサムネイル表示用 */

import { useEffect, useState, useCallback } from 'react';
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
interface PhotoRow { id: string; photo_url: string | null; photo_type: string | null; caption: string | null; sort_order: number | null; }
interface MenuRow { id: string; category: string | null; name: string; description: string | null; price: number | null; price_note: string | null; duration_minutes: number | null; is_featured: boolean | null; }
interface CouponRow { id: string; name: string; description: string | null; coupon_type: string | null; special_price: number | null; valid_from: string | null; valid_until: string | null; is_active: boolean | null; }
interface BlogRow { id: string; title: string; is_published: boolean | null; published_at: string | null; created_at: string | null; thumbnail_url: string | null; }
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
// 表示プラン確認の小バッジ
const PlanBadge = () => <button type="button" className="text-[10px] text-sky-600 border border-sky-300 rounded px-1.5 py-0.5 hover:bg-sky-50">表示プランを確認</button>;
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
      sb.from('facility_menus').select('id,category,name,description,price,price_note,duration_minutes,is_featured').eq('facility_id', facilityId).order('sort_order', { ascending: true }),
      sb.from('coupons').select('id,name,description,coupon_type,special_price,valid_from,valid_until,is_active').eq('facility_id', facilityId).order('sort_order', { ascending: true }),
      sb.from('blog_posts').select('id,title,is_published,published_at,created_at,thumbnail_url').eq('facility_id', facilityId).order('created_at', { ascending: false }),
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
            {tab === 'salon' && <SalonEditPage salonName={salonName} onToast={onToast} />}
            {tab === 'staff' && <StaffListPage rows={staff} onToast={onToast} />}
            {tab === 'photo' && <PhotoEditPage rows={photos} onToast={onToast} />}
            {tab === 'menu' && <MenuEditPage rows={menus} onToast={onToast} />}
            {tab === 'kodawari' && <KodawariPage />}
            {tab === 'tokushu' && <TokushuPage />}
            {tab === 'coupon' && <CouponListPage rows={coupons} onToast={onToast} />}
            {tab === 'blog' && <BlogListPage rows={blogs} onToast={onToast} />}
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
  const rows = [
    { label: 'サロン掲載情報', editor: '太田由香利', date: '2026/02/10', check: '要確認', reflect: { applied: true, at: '2026/05/02 15:25' } },
    { label: 'スタッフ掲載情報一覧', editor: '太田由香利', date: '2024/09/14', check: '', reflect: null },
    { label: 'フォトギャラリー掲載情報', editor: '太田由香利', date: '2024/12/13', check: '', reflect: null },
    { label: 'メニュー掲載情報', editor: '太田由香利', date: '2026/05/02', check: '', reflect: null },
    { label: 'こだわり掲載情報一覧', editor: '', date: '', check: '', empty: true, reflect: null },
    { label: '特集用掲載情報', editor: '太田由香利', date: '2026/04/23', check: '', reflect: { applied: true, at: '2026/04/23 16:17' } },
    { label: 'クーポン掲載情報', editor: '太田由香利', date: '2026/05/29', check: '', reflect: { applied: true, at: '2026/05/29 20:32' } },
  ];
  return (
    <div className="max-w-4xl space-y-5">
      <h2 className="text-base font-bold text-gray-800">掲載管理TOP</h2>

      <div>
        <SectionBar>サロンレポート</SectionBar>
        <div className="border border-t-0 border-slate-300 bg-white px-4 py-3 text-sm space-y-1.5 rounded-b">
          <p><button onClick={() => onToast('サロンレポート ダウンロード画面は準備中です')} className="text-sky-600 underline">サロンレポート ダウンロード画面</button> <span className="text-gray-500 text-xs">月ごとのレポートを作成してダウンロードすることができます。</span></p>
          <p><button onClick={() => onToast('HOT PEPPER Beauty レポートは準備中です')} className="text-sky-600 underline">HOT PEPPER Beauty レポート</button> <span className="text-gray-500 text-xs">レポート作成を待たずに概要を確認することができます。</span></p>
        </div>
      </div>

      <div>
        <SectionBar>営業が設定しているページの確認</SectionBar>
        <div className="border border-t-0 border-slate-300 bg-white px-4 py-3 text-sm rounded-b">
          <SectionBar sub>サロン基本情報</SectionBar>
          <button onClick={() => onToast('プレビューは準備中です')} className="text-sky-600 underline text-sm">プレビューを見る</button>
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
              <td className="border border-slate-200 px-3 py-2"><button onClick={() => onToast('プレビューは準備中です')} className="text-sky-600 underline">掲載中のページを見る</button></td>
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
                <td className="border border-slate-200 px-3 py-3"><button onClick={() => onToast(`${r.label} のプレビューは準備中です`)} className="text-sky-600 underline">{r.label}</button></td>
                <td className="border border-slate-200 px-3 py-3 text-center text-xs">{r.empty ? '' : <>{r.editor}<br />({r.date})</>}</td>
                <td className="border border-slate-200 px-3 py-3 text-center">{r.empty ? <span className="text-rose-500 text-xs">現在、こだわり掲載情報はありません。</span> : r.check ? <button onClick={() => onToast('掲載チェックは準備中です')} className="text-rose-500 underline text-xs">{r.check}</button> : ''}</td>
                <td className="border border-slate-200 px-3 py-3 text-center">{r.empty ? '' : <button onClick={() => onToast('詳細は準備中です')} className="text-xs text-sky-600 underline">詳細</button>}</td>
                <td className="border border-slate-200 px-3 py-3 text-center text-xs">
                  {r.reflect ? (<><span className="text-emerald-600 font-bold">反映済み</span><br /><button onClick={() => onToast('反映申請は準備中です')} className="mt-1 px-2 py-0.5 bg-gray-200 rounded text-gray-600">反映申請</button><br />({r.reflect.at})</>) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

function SalonEditPage({ salonName, onToast }: { salonName: string; onToast: (m: string) => void }) {
  const SaveBar = () => (
    <div className="flex items-center justify-end gap-2">
      <span className="text-[11px] text-rose-500 mr-auto flex items-center"><Req />必須項目</span>
      <button onClick={() => onToast('登録しました（デモ）')} className="px-6 py-1.5 bg-sky-500 text-white text-sm font-bold rounded hover:bg-sky-600">登録</button>
      <button onClick={() => onToast('キャンセルしました')} className="px-6 py-1.5 bg-gray-400 text-white text-sm font-bold rounded hover:bg-gray-500">キャンセル</button>
    </div>
  );
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
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
        <FormRow label="キャッチ" required><input className={`${input} flex-1 w-full`} placeholder="キャッチコピー" maxLength={50} /><div className="text-right"><Counter n={0} max={50} /></div></FormRow>
        <FormRow label="コピー" required><textarea className={`${input} w-full`} rows={3} placeholder="サロンの紹介文" maxLength={150} /><div className="text-right"><Counter n={0} max={150} /></div></FormRow>
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
        <FormRow label="氏名"><input className={input} maxLength={20} placeholder="氏名" /> <Counter n={0} max={20} /></FormRow>
        <FormRow label="肩書き"><input className={`${input} w-72`} maxLength={25} placeholder="肩書き" /> <Counter n={0} max={25} /></FormRow>
        <FormRow label="メッセージ"><textarea className={`${input} w-full`} rows={3} maxLength={180} placeholder="メッセージ" /><div className="text-right"><Counter n={0} max={180} /></div></FormRow>
      </Panel>

      <Panel title="サロンの雰囲気・メニューなど" plan>
        <div className="px-3 py-2 bg-amber-50/50 border-b border-slate-200 text-xs text-gray-600">雰囲気写真・メニューなど ／ キャプション</div>
        <div className="flex flex-wrap gap-4 p-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-44 text-center">
              <div className="w-full h-28 bg-gray-100 relative"><button onClick={() => onToast('削除は準備中です')} className="absolute top-0 right-0 w-4 h-4 bg-gray-500 text-white text-[10px] leading-none">×</button></div>
              <div className="text-[9px] text-gray-400 mt-0.5">画像ID：C0310666{36 + i}</div>
              <label className="flex items-center justify-center gap-0.5 text-[9px] text-gray-500"><input type="checkbox" />画像応募</label>
              <div className="flex items-start gap-1 mt-1"><textarea className={`${input} flex-1 text-xs`} rows={2} maxLength={30} placeholder="キャプション" /><Counter n={0} max={30} /></div>
              <div className="flex justify-center gap-1 mt-0.5 text-[9px]"><button onClick={() => onToast('準備中です')} className="px-1 bg-sky-100 text-sky-600 rounded">前へ</button><button onClick={() => onToast('準備中です')} className="px-1 bg-sky-100 text-sky-600 rounded">後ろへ</button></div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="サロン情報" plan>
        <FormRow label="お店ロゴ"><div className="w-24 h-20 bg-gray-100 mb-1" /><button onClick={() => onToast('アップロードは準備中です')} className="px-2 py-0.5 bg-sky-500 text-white text-[10px] rounded">アップロード</button> <button onClick={() => onToast('削除は準備中です')} className="px-2 py-0.5 bg-gray-200 text-gray-600 text-[10px] rounded">削除</button></FormRow>
        <FormRow label="アクセス" required><input className={`${input} w-full`} maxLength={40} placeholder="最寄駅からのアクセス" /> <Counter n={0} max={40} /></FormRow>
        <FormRow label="道案内・アクセス"><textarea className={`${input} w-full`} rows={3} maxLength={200} placeholder="道案内" /><div className="text-right"><Counter n={0} max={200} /></div></FormRow>
        <FormRow label="営業時間" required><textarea className={`${input} w-full`} rows={2} maxLength={100} placeholder="9:00〜19:00" /><div className="text-right"><Counter n={0} max={100} /></div></FormRow>
        <FormRow label="定休日" required><input className={`${input} w-full`} maxLength={50} placeholder="日曜日・年末年始" /> <Counter n={0} max={50} /></FormRow>
        <FormRow label="支払い方法">
          <div className="grid grid-cols-3 gap-1 text-xs">{['Visa', 'Mastercard', 'JCB', 'American Express', 'Diners Club', 'UnionPay（銀聯）', 'Discover'].map((c) => <label key={c} className="flex items-center gap-1"><input type="checkbox" />{c}</label>)}</div>
          <label className="flex items-center gap-1 text-xs mt-1"><input type="checkbox" />その他</label>
          <input className={`${input} w-full mt-1`} maxLength={40} placeholder="PayPay・auPAY・LINEPay・d払い・メルPay 等" /> <Counter n={0} max={40} />
        </FormRow>
        <FormRow label="設備">
          <div className="flex gap-8">
            <div>
              <div className="flex items-center gap-2 text-xs mb-1">総数<input className={`${input} w-12`} defaultValue={0} /></div>
              {[1, 2, 3].map((n) => <div key={n} className="flex items-center gap-1 mb-1"><input type="checkbox" /><span className="text-xs text-gray-500 w-4">{n}</span><select className={`${input} w-40 bg-white`}><option>リクライニングチェア</option></select><input className={`${input} w-12`} placeholder="数" /></div>)}
              <button onClick={() => onToast('追加は準備中です')} className="text-sky-600 underline text-xs">追加する</button>
            </div>
            <div>
              <div className="text-xs font-bold text-gray-600 mb-1">スタッフ数</div>
              <div className="flex items-center gap-2 text-xs mb-1">総数<input className={`${input} w-12`} defaultValue={0} /> 人</div>
              {[1, 2, 3].map((n) => <div key={n} className="flex items-center gap-1 mb-1"><input type="checkbox" /><span className="text-xs text-gray-500 w-4">{n}</span><select className={`${input} w-36 bg-white`}><option>施術者（まつげ）</option></select><input className={`${input} w-12`} placeholder="数" /><span className="text-xs">人</span></div>)}
              <button onClick={() => onToast('追加は準備中です')} className="text-sky-600 underline text-xs">追加する</button>
            </div>
          </div>
        </FormRow>
        <FormRow label="駐車場"><input className={`${input} w-full`} maxLength={20} placeholder="提携駐車場あり 等" /> <Counter n={0} max={20} /></FormRow>
        <FormRow label="備考"><textarea className={`${input} w-full`} rows={3} maxLength={100} placeholder="備考" /><div className="text-right"><Counter n={0} max={100} /></div></FormRow>
      </Panel>

      <Panel title="お店情報" plan>
        <FormRow label="ジャンル" required>
          <div className="space-y-1">{[1, 2, 3, 4, 5, 6].map((n) => <div key={n} className="flex items-center gap-2"><span className="text-xs text-gray-500 w-4">{n}</span><select className={`${input} w-56 bg-white`} defaultValue={n === 1 ? 'まつげ・メイクなど' : n === 2 ? 'エステ' : '未選択'}><option>未選択</option><option>まつげ・メイクなど</option><option>エステ</option></select></div>)}</div>
        </FormRow>
        <FormRow label="男性施術者区分"><div className="flex gap-4 text-xs">{['男性施術者のみ', '男性施術者もいる', '表示なし'].map((o) => <label key={o} className="flex items-center gap-1"><input type="radio" name="male" defaultChecked={o === '表示なし'} />{o}</label>)}</div></FormRow>
      </Panel>

      <Panel title="メンズにもオススメ表示・メンズ用切替設定">
        <FormRow label="メンズ"><label className="flex items-center gap-1 text-xs"><input type="checkbox" />メンズ利用OK</label><p className="text-[11px] text-gray-400 mt-1">※メンズ向け特集に参画されている場合は、設定内容に関わらずサロンデータに「メンズにもオススメ」と表示されます。</p></FormRow>
      </Panel>

      <Panel title="こだわり条件(サロンデータ)">
        <FormRow label="こだわり条件">
          <div className="grid grid-cols-3 gap-1 text-xs">{['夜20時以降も受付OK', '当日受付OK', '2名以上の利用OK', '女性専用', '個室あり', '駐車場あり', '駅から徒歩5分以内', '2回目以降特典あり', '店頭でのカード支払いOK'].map((o) => <label key={o} className="flex items-center gap-1"><input type="checkbox" />{o}</label>)}</div>
        </FormRow>
        <FormRow label="サロン設備・サービス">
          <div className="grid grid-cols-3 gap-1 text-xs">{['24時間営業', '始発まで営業している', '朝10時前でも受付OK', '年中無休', '女性スタッフ在籍', '完全予約制', '指名予約OK', '1人で貸切OK', 'ショッピングモール内にある', 'ドリンクサービスあり', 'DVDが視聴できる', '喫煙OK', 'お子さま同伴可', 'キッズスペースあり', 'リクライニングチェア（ベッド）', 'メイクルームあり', '着替えあり', 'アメニティまたはコスメが充実', '3席（ベッド）以下の小型サロン', '10席（ベッド）以上の大型サロン', 'つけ放題メニューあり', '都度払いメニューあり', '体験メニューあり', 'ブライダルメニューあり', '回数券あり', 'スクール併設', 'COIN+支払いOK'].map((o) => <label key={o} className="flex items-center gap-1"><input type="checkbox" />{o}</label>)}</div>
        </FormRow>
      </Panel>

      <Panel title="こだわり条件(メニュー)">
        <FormRow label="まつげ・メイクなど">
          <div className="grid grid-cols-3 gap-1 text-xs">{['まつげメニュー（要美容師免許※1）', 'ヘアセット', 'メイク', '着付け', '眉カット（要美容師免許※1）', 'シェービング（要理容師免許※1）', 'ネイル同時施術OK'].map((o) => <label key={o} className="flex items-center gap-1"><input type="checkbox" />{o}</label>)}</div>
        </FormRow>
        <FormRow label="エステ（フェイシャル）">
          <div className="grid grid-cols-3 gap-1 text-xs">{['毛穴ケア', '小顔・リフトアップ', 'はり・つや', '美白ケア', '乾燥肌・保湿ケア', '黒ずみ・くすみ', 'シェービング（要理容師免許※1）'].map((o) => <label key={o} className="flex items-center gap-1"><input type="checkbox" />{o}</label>)}</div>
        </FormRow>
        <FormRow label="エステ（脱毛）">
          <div className="grid grid-cols-3 gap-1 text-xs">{['ワキ', '腕（ヒジ上・ヒジ下）', '脚（ヒザ上・ヒザ下）', 'V・I・Oライン', '全身', 'その他（顔・指・胸・背中など）'].map((o) => <label key={o} className="flex items-center gap-1"><input type="checkbox" />{o}</label>)}</div>
        </FormRow>
        <FormRow label="エステ（ボディ）">
          <div className="grid grid-cols-3 gap-1 text-xs">{['痩身', '美脚（太もも・ふくらはぎ・足首）', '小尻・ヒップアップ', '二の腕', '背中', 'ウエスト', 'バスト', 'シェービング（要理容師免許※1）', '美肌ケア', '耳つぼ', 'ボディトレーニング'].map((o) => <label key={o} className="flex items-center gap-1"><input type="checkbox" />{o}</label>)}</div>
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
function StaffListPage({ rows, onToast }: { rows: StaffRow[]; onToast: (m: string) => void }) {
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
                  <button onClick={() => onToast('非掲載設定は準備中です')} className="block w-full px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs">{s.is_active ? '非掲載にする' : '掲載にする'}</button>
                  <button onClick={() => onToast('削除は準備中です')} className="block w-full px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">削除する</button>
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
function PhotoEditPage({ rows, onToast }: { rows: PhotoRow[]; onToast: (m: string) => void }) {
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
  return (
    <div className="max-w-4xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">フォトギャラリー掲載情報編集</h2>
      <p className="text-[11px] text-gray-500">※「画像応募」にチェックをすると、Hot Pepper Beautyサイトの特集/メルマガ/装飾・バナー/公式Facebookページ等に使用される対象となります <button onClick={() => onToast('使用事例は準備中です')} className="text-sky-600 underline">使用事例はこちら</button></p>
      <div className="flex justify-end gap-2"><button onClick={() => onToast('登録しました（デモ）')} className="px-5 py-1.5 bg-sky-500 text-white text-sm font-bold rounded">登録</button><button onClick={() => onToast('キャンセルしました')} className="px-5 py-1.5 bg-gray-400 text-white text-sm font-bold rounded">キャンセル</button></div>
      <button onClick={() => onToast('入力欄の追加は準備中です')} className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded">入力欄を追加する</button>
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
              <button onClick={() => onToast('アップロードは準備中です')} className="mt-1 px-2 py-0.5 bg-sky-500 text-white text-[10px] rounded block mx-auto">アップロード</button>
              <button onClick={() => onToast('削除は準備中です')} className="mt-0.5 px-2 py-0.5 bg-gray-200 text-gray-600 text-[10px] rounded block mx-auto">削除</button>
              <label className="flex items-center gap-1 text-[10px] text-gray-500 mt-1 justify-center"><input type="checkbox" />画像応募</label>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2"><span className="w-20 text-xs text-gray-500 whitespace-nowrap">タイトル</span><input className={`${input} flex-1`} maxLength={15} placeholder="タイトル" /><Counter n={0} max={15} /><button onClick={() => onToast('クリアは準備中です')} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-[10px]">クリア</button></div>
              <div className="flex items-start gap-2"><span className="w-20 text-xs text-gray-500 whitespace-nowrap">キャプション</span><textarea className={`${input} flex-1`} rows={2} maxLength={30} defaultValue={p.caption ?? ''} /><Counter n={(p.caption ?? '').length} max={30} /></div>
              <div className="flex items-center gap-2"><span className="w-20 text-xs text-gray-500 whitespace-nowrap">ジャンル</span><select className={`${input} bg-white`}><option>まつげ・メイクなど</option><option>エステ</option></select>
                <span className="ml-auto flex items-center gap-3 text-xs"><label className="flex items-center gap-1"><input type="radio" name={`pub${i}`} defaultChecked />掲載</label><label className="flex items-center gap-1"><input type="radio" name={`pub${i}`} />非掲載</label></span>
              </div>
              <div className="flex items-center gap-2"><span className="w-20 text-xs text-gray-500 whitespace-nowrap">検索用カテゴリ</span><select className={`${input} bg-white`}><option>その他</option><option>まつエク［こだわり素材］</option></select></div>
              <div className="flex items-center gap-2"><span className="w-20 text-xs text-gray-500 whitespace-nowrap">クーポン</span><button onClick={() => onToast('クーポン選択は準備中です')} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">クーポン選択</button></div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

/* ========================= メニュー掲載情報編集 ========================= */
function MenuEditPage({ rows, onToast }: { rows: MenuRow[]; onToast: (m: string) => void }) {
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm';
  return (
    <div className="max-w-4xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">メニュー掲載情報編集</h2>
      <div className="flex justify-end gap-2"><button onClick={() => onToast('登録しました（デモ）')} className="px-5 py-1.5 bg-sky-500 text-white text-sm font-bold rounded">登録</button><button onClick={() => onToast('キャンセルしました')} className="px-5 py-1.5 bg-gray-400 text-white text-sm font-bold rounded">キャンセル</button></div>
      <Panel title="メニュー備考">
        <FormRow label="備考"><textarea className={`${input} w-full`} rows={4} maxLength={500} placeholder="メニュー全体の備考" /><div className="text-right"><Counter n={0} max={500} /></div></FormRow>
      </Panel>
      <Panel title="メニュー設定">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">メニューが登録されていません</div>
        ) : rows.map((m, i) => (
          <div key={m.id} className="flex gap-3 border-b border-slate-200 last:border-0 p-3 text-sm">
            <div className="shrink-0 text-xs font-bold text-gray-500 w-10 text-center">No.<br /><input className="w-8 border border-gray-300 rounded text-center" defaultValue={i + 1} /></div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2"><span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">カテゴリ</span><select className={`${input} bg-white`} defaultValue={m.category ?? ''}><option value="">まつげ・メイクなど</option>{m.category && <option value={m.category}>{m.category}</option>}</select>
                <span className="w-16 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded ml-2">メニュー名</span><input className={`${input} flex-1`} defaultValue={m.name} maxLength={40} /><span className="text-[10px] text-gray-400 whitespace-nowrap">{hpbLen(m.name)}<br />/40</span></div>
              <div className="flex items-start gap-2"><span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">メニュー説明</span><textarea className={`${input} flex-1`} rows={2} defaultValue={m.description ?? ''} maxLength={70} /><span className="text-[10px] text-gray-400 whitespace-nowrap">{hpbLen(m.description ?? '')}<br />/70</span></div>
              <div className="flex items-center gap-2"><span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">検索用カテゴリ</span><select className={`${input} bg-white`}><option>まつげ・メイクなど：まつげデザイン・ケア</option></select></div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">価格</span><span className="text-xs">¥</span><input className={`${input} w-24`} defaultValue={m.price ?? ''} />
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" />「〜」を表示</label>
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" />「要問い合わせ」として表示する</label>
              </div>
              <p className="text-[10px] text-gray-400 pl-24">※チェックして掲載する場合、予約不可メニューとして掲載されます。</p>
              <div className="flex items-center gap-3">
                <span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">所要目安時間</span><input className={`${input} w-16`} defaultValue={m.duration_minutes ?? ''} /><span className="text-xs">分</span>
                {m.duration_minutes ? <span className="text-xs text-gray-600">{minToHM(m.duration_minutes)}</span> : null}
                <span className="text-[10px] text-gray-400">※予約時の時間計算に利用します</span>
              </div>
              <div className="flex items-center gap-3"><span className="w-24 text-xs text-gray-500 bg-amber-50 px-1 py-0.5 rounded">予約</span><label className="flex items-center gap-1 text-xs"><input type="radio" name={`yoyaku${i}`} defaultChecked />予約可</label><label className="flex items-center gap-1 text-xs"><input type="radio" name={`yoyaku${i}`} />予約不可</label>
                <span className="ml-auto flex items-center gap-3 text-xs"><button onClick={() => onToast('削除は準備中です')} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded">削除</button><label className="flex items-center gap-1"><input type="radio" name={`mpub${i}`} defaultChecked />掲載</label><label className="flex items-center gap-1"><input type="radio" name={`mpub${i}`} />非掲載</label></span>
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
function CouponListPage({ rows, onToast }: { rows: CouponRow[]; onToast: (m: string) => void }) {
  return (
    <div className="max-w-5xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">クーポン掲載情報一覧</h2>
      <div className="flex justify-between">
        <button onClick={() => onToast('新規追加は準備中です')} className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded">クーポン新規追加</button>
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
                <td className="border border-slate-200 px-2 py-3"><button onClick={() => onToast('詳細は準備中です')} className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs">詳細</button></td>
                <td className="border border-slate-200 px-2 py-3 space-y-1">
                  <button onClick={() => onToast('非掲載設定は準備中です')} className="block w-full px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs">非掲載にする</button>
                  <button onClick={() => onToast('削除は準備中です')} className="block w-full px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">削除する</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ========================= ブログ一覧 ========================= */
function BlogListPage({ rows, onToast }: { rows: BlogRow[]; onToast: (m: string) => void }) {
  return (
    <div className="max-w-5xl space-y-3">
      <h2 className="text-base font-bold text-gray-800">ブログ一覧</h2>
      <div className="text-[11px] text-gray-500 leading-relaxed">
        <p>ブログ機能は、NRプラン以上でご利用いただけます。</p>
        <p>ブログは「掲載管理TOP」画面から「掲載変更を反映する」を押さなくても、ブログ投稿完了するとそのまま反映されます。</p>
        <p className="text-rose-500 font-bold">ブログを投稿したスタッフが非掲載の場合、ブログも一緒に非掲載になります。</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => onToast('新規投稿は準備中です')} className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded">新規投稿</button>
        <button onClick={() => onToast('投稿者追加・編集は準備中です')} className="px-3 py-1.5 border border-sky-400 text-sky-600 text-xs font-bold rounded">投稿者追加・編集</button>
        <div className="ml-auto flex items-center gap-1"><select className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"><option></option></select><button onClick={() => onToast('絞込みは準備中です')} className="px-2 py-1 bg-sky-500 text-white text-xs rounded">絞込み</button><button onClick={() => onToast('絞込み解除は準備中です')} className="px-2 py-1 border border-gray-300 text-gray-600 text-xs rounded">絞込み解除</button></div>
      </div>
      <p className="text-xs text-gray-600">該当するブログが <span className="text-rose-500 font-bold">{rows.length}</span> 件あります</p>
      <div className="bg-white border border-slate-300 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-amber-50 text-gray-600 text-xs">
            {['タイトル/カテゴリ/クーポン', '画像(1枚目)', '掲載者(最終更新者)', '初回掲載日時(最終更新日時)/ステータス', '詳細/削除'].map((h) => <th key={h} className="border border-slate-200 px-2 py-1.5 font-bold">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">ブログが登録されていません</td></tr>
            ) : rows.map((b) => (
              <tr key={b.id} className="align-top">
                <td className="border border-slate-200 px-2 py-3"><button onClick={() => onToast('ブログ編集は準備中です')} className="text-sky-600 underline text-xs">{b.title}</button><div className="text-[10px] text-gray-400 mt-1">ビューティー</div></td>
                <td className="border border-slate-200 px-2 py-3 text-center">{b.thumbnail_url ? <img src={b.thumbnail_url} alt="" className="w-16 h-12 object-cover mx-auto" /> : <div className="w-16 h-12 bg-gray-100 mx-auto" />}</td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">スタッフ</td>
                <td className="border border-slate-200 px-2 py-3 text-center text-xs">{fmtDate(b.published_at ?? b.created_at)}<br /><span className={b.is_published ? 'text-emerald-600' : 'text-gray-400'}>{b.is_published ? '掲載中' : '非掲載'}</span></td>
                <td className="border border-slate-200 px-2 py-3 text-center"><button onClick={() => onToast('詳細は準備中です')} className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs mb-1">詳細</button><br /><button onClick={() => onToast('削除は準備中です')} className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">削除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
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
