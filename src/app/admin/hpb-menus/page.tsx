'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import Modal from '@/components/Modal';
import LoadError from '@/components/admin/LoadError';
import { SbBadge, SbInput, SbPageHeader } from '@/components/admin/SbUi';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import FacilitySelector from '@/components/admin/FacilitySelector';
import AdminFacilityScope, { type AdminFacilityScopeValue } from '@/components/admin/AdminFacilityScope';

/** hpb_menu_durations 1行(GET /api/admin/hpb-menus のレスポンス)。 */
interface HpbMenu {
  facility_id: string;
  ref_id: string;
  kind: string;
  store_id: string;
  name: string;
  target: string | null;
  duration_min: number | null;
  price: number | null;
  description: string | null;
  name_override: string | null;
  duration_min_override: number | null;
  price_override: number | null;
  description_override: string | null;
  is_hidden: boolean;
  /** HPB の最新の取得に無かった時刻（掲載終了）。null＝HPB にある。 */
  missing_since: string | null;
  /** お客様メニューへ反映した時刻。null＝まだ反映していない。 */
  applied_at: string | null;
}

/** POST /api/admin/hpb-menus/apply の結果（applyHpbMenusToFacilityMenus）。 */
interface ApplyResult {
  inserted: number;
  existing: number;
  hidden: number;
  skipped: number;
  coupons: number;
  ended: number;
  other_store: number;
  deleted: number;
}

interface EditForm {
  ref_id: string;
  name_override: string;
  duration_min_override: string;
  price_override: string;
  description_override: string;
  is_hidden: boolean;
  applied: boolean;
}

const PAGE_TITLE = 'HPBメニュー取得';

const yen = (n: number | null): string => (n == null ? '—' : `¥${n.toLocaleString()}`);
const minutes = (n: number | null): string => (n == null ? '—' : `${n}分`);

/**
 * 公開後に何が起きるかの案内。メニューを公開しただけでは、店舗ページが非公開のままだったり予約受付の準備
 * （写真・スタッフ・営業時間など）が済んでいなかったりすると、お客様に表示されずネット予約もできない。
 * 一括反映を使うのは掲載準備中が多いため、条件を省いた約束をしない。
 */
const PUBLISH_NEXT_STEP = '公開したメニューが、お客様向けメニューとネット予約の対象になります（店舗ページの公開と予約受付の準備も必要です）';

/** 一括反映の結果を、作ったもの・作らなかったもの（とその理由）に分けて伝える。 */
function applySummary(r: ApplyResult): string {
  const parts = [`新規${r.inserted}件（非公開で作成）`];
  if (r.existing > 0) parts.push(`既にあるメニュー${r.existing}件は変更していません`);
  if (r.hidden > 0) parts.push(`非表示にした${r.hidden}件を非公開にしました`);
  if (r.coupons > 0) parts.push(`クーポン${r.coupons}件は反映していません`);
  const gone = r.ended + r.other_store;
  if (gone > 0) parts.push(`HPBに無くなった${gone}件は反映していません`);
  if (r.deleted > 0) parts.push(`メニュー管理で削除した${r.deleted}件は作り直していません`);
  if (r.skipped > 0) parts.push(`名前が空の${r.skipped}件は反映していません`);
  return `メニューへ反映: ${parts.join(' / ')}`;
}

// 複数店舗のオーナーは ?facility_id= で店舗を選ぶ（2026年10月23日）。以前は facility_members を
// .limit(1).single() で 1 行だけ読み、どの店舗の HPB 店舗ID・メニューを扱うかが行の並び次第だった
// （別の店舗の店舗IDを上書きし、別の店舗のメニューへ反映し得た）。
export default function AdminHpbMenusPage() {
  return <AdminFacilityScope title={PAGE_TITLE} path="/admin/hpb-menus">{(scope) => <HpbMenus {...scope} />}</AdminFacilityScope>;
}

function HpbMenus({ facilityId, choices }: AdminFacilityScopeValue) {
  const [menus, setMenus] = useState<HpbMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [slnId, setSlnId] = useState('');
  const [savedSlnId, setSavedSlnId] = useState<string | null>(null);
  const [savingSln, setSavingSln] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [applying, setApplying] = useState(false);
  // 直近の一括反映で非公開のまま作られたメニュー数。トーストは消えるため、次の手順を画面に残す。
  const [appliedDrafts, setAppliedDrafts] = useState(0);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  const loadMenus = useCallback(async () => {
    const res = await fetch(`/api/admin/hpb-menus?facility_id=${facilityId}`);
    if (!res.ok) throw new Error();
    const json = await res.json();
    setMenus((json.menus ?? []) as HpbMenu[]);
  }, [facilityId]);

  // retry は再取得を state（reloadKey）経由で駆動する。reload をイベントハンドラからも
  // effect からも呼べる形にすると React Compiler の set-state-in-effect 検出対象になるため、
  // 実処理は effect 側にだけ inline し（loadMenus の外部呼び出しも含めて）、
  // イベントハンドラ側は reloadKey を進めるだけにする。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        setLoadError(false);
        const { data: profile, error: profErr } = await supabase
          .from('facility_profiles').select('hpb_sln_id').eq('id', facilityId).single();
        if (cancelled) return;
        if (profErr) { setLoadError(true); setLoading(false); return; }
        const sln = (profile?.hpb_sln_id as string | null) ?? null;
        setSavedSlnId(sln);
        setSlnId(sln ?? '');

        const res = await fetch(`/api/admin/hpb-menus?facility_id=${facilityId}`);
        if (cancelled) return;
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (cancelled) return;
        setMenus((json.menus ?? []) as HpbMenu[]);
        setLoading(false);
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [facilityId, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const handleSaveSln = async () => {
    if (savingSln) return;
    const trimmed = slnId.trim();
    if (trimmed && !/^[A-Za-z0-9]{1,32}$/.test(trimmed)) {
      setToast({ type: 'error', message: 'HPB 店舗IDは英数字で入力してください' });
      return;
    }
    setSavingSln(true);
    try {
      const res = await fetch(`/api/admin/hpb-menus?facility_id=${facilityId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hpb_sln_id: trimmed }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setSavedSlnId(json.hpb_sln_id ?? null);
      setSlnId(json.hpb_sln_id ?? '');
      setToast({ type: 'success', message: '保存しました' });
    } catch {
      setToast({ type: 'error', message: '保存に失敗しました' });
    } finally {
      setSavingSln(false);
    }
  };

  const handleScrape = async () => {
    if (scraping) return;
    setScraping(true);
    try {
      const res = await fetch(`/api/admin/hpb-menus?facility_id=${facilityId}`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        if (typeof json?.saved === 'number' && json.saved > 0) await loadMenus();
        setToast({ type: 'error', message: json?.error || '取得に失敗しました' });
        return;
      }
      setToast({
        type: 'success',
        message: `取得 ${json.fetched}件中 ${json.saved}件を保存（スキップ${json.skipped} / 失敗${json.failed}）`
          + (json.missing > 0 ? `。HPBに無くなった${json.missing}件はお客様メニューへの反映の対象から外しました` : ''),
      });
      await loadMenus();
    } catch {
      // 応答だけ失われ、保存が完了している可能性があるため再読込で状態を照合する。
      await loadMenus().catch(() => undefined);
      setToast({ type: 'error', message: '取得に失敗しました' });
    } finally {
      setScraping(false);
    }
  };

  const handleApply = async () => {
    if (applying) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/admin/hpb-menus/apply?facility_id=${facilityId}`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setToast({ type: 'error', message: json?.error || '反映に失敗しました' });
        return;
      }
      const result = json as ApplyResult;
      setAppliedDrafts(result.inserted);
      setToast({
        type: 'success',
        message: applySummary(result) + (result.inserted > 0 ? `。${PUBLISH_NEXT_STEP}` : ''),
      });
      // 「反映済み」の表示を最新にする（失敗しても反映そのものは済んでいるので結果の表示は残す）。
      await loadMenus().catch(() => undefined);
    } catch {
      setToast({ type: 'error', message: '反映に失敗しました' });
    } finally {
      setApplying(false);
    }
  };

  const startEdit = (m: HpbMenu) => {
    setEditForm({
      ref_id: m.ref_id,
      name_override: m.name_override ?? '',
      duration_min_override: m.duration_min_override == null ? '' : String(m.duration_min_override),
      price_override: m.price_override == null ? '' : String(m.price_override),
      description_override: m.description_override ?? '',
      is_hidden: m.is_hidden,
      applied: m.applied_at != null,
    });
  };

  const handleSaveEdit = async () => {
    if (!editForm || saving) return;
    const dur = editForm.duration_min_override.trim();
    const price = editForm.price_override.trim();
    if (dur && !/^\d{1,4}$/.test(dur)) {
      setToast({ type: 'error', message: '施術時間は数字（分）で入力してください' });
      return;
    }
    if (price && !/^\d{1,7}$/.test(price)) {
      setToast({ type: 'error', message: '価格は数字（円）で入力してください' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ref_id: editForm.ref_id,
        name_override: editForm.name_override.trim() || null,
        duration_min_override: dur ? parseInt(dur, 10) : null,
        price_override: price ? parseInt(price, 10) : null,
        description_override: editForm.description_override.trim() || null,
        is_hidden: editForm.is_hidden,
      };
      const res = await fetch(`/api/admin/hpb-menus?facility_id=${facilityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      setToast({ type: 'success', message: '更新しました' });
      setEditForm(null);
      await loadMenus();
    } catch {
      setToast({ type: 'error', message: '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  const selector = (
    <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/hpb-menus"
      busy={savingSln || scraping || applying || saving}
      dirty={editForm !== null || slnId.trim() !== (savedSlnId ?? '').trim()} />
  );

  if (loading) return <>{selector}<AdminPageLoading /></>;

  // 一括反映の対象になるのは、今の店舗IDで取得し、最新の取得でも HPB にあった行だけ（サーバーと同じ判定）。
  const currentSln = savedSlnId?.trim() || null;
  const isCurrent = (m: HpbMenu) => m.store_id === currentSln && !m.missing_since;
  const currentMenus = menus.filter(isCurrent);
  const goneMenus = menus.filter((m) => !isCurrent(m));
  const menusHref = `/admin/menus?facility_id=${facilityId}`;

  const renderRow = (m: HpbMenu) => {
    const name = m.name_override ?? m.name;
    const dur = m.duration_min_override ?? m.duration_min;
    const price = m.price_override ?? m.price;
    const desc = m.description_override ?? m.description;
    const edited = m.name_override != null || m.duration_min_override != null || m.price_override != null || m.description_override != null;
    const otherStore = m.store_id !== currentSln;
    // 非表示の行は不透明度ではなく地色で示す（opacity は文字のコントラストまで落とし AA を割るため）。
    return (
      <div key={`${m.kind}-${m.ref_id}`} className={`flex items-start gap-4 p-4 ${m.is_hidden ? 'bg-gray-50' : ''}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <SbBadge tone={m.kind === 'coupon' ? 'info' : 'neutral'}>{m.kind === 'coupon' ? 'クーポン' : 'メニュー'}</SbBadge>
            {m.target && m.target !== '?' && <SbBadge tone="neutral">{m.target}</SbBadge>}
            {otherStore
              ? <SbBadge tone="warning">別の店舗ID（{m.store_id}）</SbBadge>
              : m.missing_since && <SbBadge tone="warning">HPBで掲載終了</SbBadge>}
            {m.kind === 'coupon' && <SbBadge tone="neutral">反映対象外</SbBadge>}
            {m.applied_at && <SbBadge tone="success">反映済み</SbBadge>}
            {m.is_hidden && <SbBadge tone="neutral">非表示</SbBadge>}
            <p className="font-medium text-sm truncate">{name}</p>
          </div>
          <p className="text-xs text-gray-600 mt-1">
            {minutes(dur)} / {yen(price)}
          </p>
          {desc && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{desc}</p>}
          {edited && (
            <p className="text-[11px] text-amber-700 mt-1">手直し済（取得元: {m.name} / {minutes(m.duration_min)} / {yen(m.price)}）</p>
          )}
        </div>
        <button type="button" onClick={() => startEdit(m)} className="p-2 text-gray-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition-colors shrink-0" aria-label={`${name}を編集`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
        </button>
      </div>
    );
  };

  return (
    <div>
      {selector}
      <SbPageHeader
        title={PAGE_TITLE}
        description="ホットペッパービューティーの予約ページから、メニュー名・施術時間・価格・内容を取得します。取得後の手直し（名前・時間・価格・非表示）は再取得しても消えません。"
      />

      {/* HPB 店舗ID 設定 */}
      <div className="bg-white rounded-xl shadow-xs p-5 mb-6">
        <label htmlFor="hpb-sln" className="form-label">HPB 店舗ID（slnID）</label>
        <p className="text-xs text-gray-500 mb-2">
          ホットペッパービューティーの店舗ページURL <code>beauty.hotpepper.jp/kr/sln<b>H000537368</b>/</code> の
          <code>H</code>で始まる英数字です（入力例: H000537368）。
        </p>
        <div className="flex gap-2 items-start">
          <SbInput
            id="hpb-sln"
            value={slnId}
            onChange={(e) => setSlnId(e.target.value)}
            maxLength={32}
            className="flex-1"
          />
          <button type="button" onClick={handleSaveSln} disabled={savingSln} className="btn-primary px-5 py-2.5! shrink-0">
            {savingSln ? '保存中...' : '保存'}
          </button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleScrape}
            disabled={scraping || !savedSlnId}
            className="btn-primary px-5 py-2.5!"
          >
            {scraping ? '取得中...' : 'HPBから取得'}
          </button>
          {!savedSlnId && <span className="text-xs text-gray-500">先に店舗IDを保存してください</span>}
        </div>
      </div>

      {/* メニュー一覧 */}
      {loadError ? (
        <LoadError onRetry={reload} message="HPBメニューの読み込みに失敗しました" />
      ) : menus.length === 0 ? (
        <div className="bg-white rounded-xl shadow-xs p-12 text-center">
          <p className="text-gray-500">まだ取得していません。店舗IDを保存して「HPBから取得」を押してください。</p>
        </div>
      ) : (
        <>
        <div className="bg-white rounded-xl shadow-xs p-5 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleApply}
              disabled={applying}
              className="btn-primary px-5 py-2.5!"
            >
              {applying ? '反映中...' : 'お客様メニューへ一括反映'}
            </button>
            <span className="text-xs text-gray-600">
              HPBの「メニュー」のうち、まだお客様メニューに無いものを<b>非公開（下書き）</b>で追加します。
              <Link href={menusHref} className="text-sky-700 underline">メニュー管理</Link>で「公開する」を押すまでお客様には表示されません。
              既にあるメニューは変更しません（料金や時間の変更はメニュー管理で行ってください）。
              クーポンは、新規・再来などの対象条件や割引価格を引き継げないため反映しません。
            </span>
          </div>
          {appliedDrafts > 0 && (
            <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-800" role="status">
              新しく反映したメニュー{appliedDrafts}件は非公開です。
              <Link href={menusHref} className="font-bold text-sky-700 underline">メニュー管理</Link>
              で「公開する」（まとめて公開するときは「非公開のメニューをすべて公開する」）を押してください。{PUBLISH_NEXT_STEP}。
            </p>
          )}
        </div>
        {currentMenus.length > 0 && (
          <div className="bg-white rounded-xl shadow-xs divide-y">
            {currentMenus.map(renderRow)}
          </div>
        )}
        {goneMenus.length > 0 && (
          <section aria-labelledby="hpb-gone-heading" className="mt-6">
            <h2 id="hpb-gone-heading" className="text-sm font-bold text-gray-800 mb-1">HPBに無くなったメニュー（{goneMenus.length}件）</h2>
            <p className="text-xs text-gray-600 mb-2">
              最新の取得で見つからなかったもの、または今の店舗IDとは別の店舗IDで取得したものです。お客様メニューへは反映しません。
              「反映済み」のものはメニュー管理に残っています。お店で扱わない場合は
              <Link href={menusHref} className="text-sky-700 underline">メニュー管理</Link>で非公開にしてください。
            </p>
            <div className="bg-white rounded-xl shadow-xs divide-y">
              {goneMenus.map(renderRow)}
            </div>
          </section>
        )}
        </>
      )}

      {/* 編集モーダル */}
      {editForm && (
        <Modal
          open
          onClose={() => setEditForm(null)}
          title="メニューを手直し"
          footer={
            <div className="flex gap-3">
              <button type="button" onClick={() => setEditForm(null)} className="flex-1 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">キャンセル</button>
              <button type="button" onClick={handleSaveEdit} disabled={saving} className="btn-primary flex-1 py-2.5!">{saving ? '保存中...' : '保存'}</button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-gray-500">空欄にすると取得元の値に戻ります。手直しした値は再取得しても消えません。</p>
            {editForm.applied && (
              <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-2">
                このメニューはお客様メニューに反映済みです。名前・時間・価格・内容をここで直しても、お客様メニューは変わりません（メニュー管理で直してください）。「使わない（非表示）」にすると、次の一括反映でお客様メニューを非公開にします。
              </p>
            )}
            <div>
              <label htmlFor="hpb-name" className="form-label">名前</label>
              <SbInput id="hpb-name" value={editForm.name_override} onChange={(e) => setEditForm({ ...editForm, name_override: e.target.value })} maxLength={200} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="hpb-dur" className="form-label">施術時間（分）</label>
                <SbInput id="hpb-dur" type="number" min={0} value={editForm.duration_min_override} onChange={(e) => setEditForm({ ...editForm, duration_min_override: e.target.value })} />
              </div>
              <div>
                <label htmlFor="hpb-price" className="form-label">価格（円）</label>
                <SbInput id="hpb-price" type="number" min={0} value={editForm.price_override} onChange={(e) => setEditForm({ ...editForm, price_override: e.target.value })} />
              </div>
            </div>
            <div>
              <label htmlFor="hpb-desc" className="form-label">内容</label>
              <textarea id="hpb-desc" value={editForm.description_override} onChange={(e) => setEditForm({ ...editForm, description_override: e.target.value })} maxLength={2000} rows={3} className="w-full rounded-lg border-gray-300 text-sm focus:ring-sky-500 focus:border-sky-500" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editForm.is_hidden} onChange={(e) => setEditForm({ ...editForm, is_hidden: e.target.checked })} className="rounded-sm border-gray-300 text-sky-500 focus:ring-sky-500" />
              <span className="text-sm">このメニューを使わない（非表示）</span>
            </label>
          </div>
        </Modal>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
