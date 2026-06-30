'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import Modal from '@/components/Modal';
import LoadError from '@/components/admin/LoadError';
import { SbBadge, SbInput, SbPageHeader } from '@/components/admin/SbUi';
import AdminPageLoading from '@/components/admin/AdminPageLoading';

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
}

interface EditForm {
  ref_id: string;
  name_override: string;
  duration_min_override: string;
  price_override: string;
  description_override: string;
  is_hidden: boolean;
}

const yen = (n: number | null): string => (n == null ? '—' : `¥${n.toLocaleString()}`);
const minutes = (n: number | null): string => (n == null ? '—' : `${n}分`);

export default function AdminHpbMenusPage() {
  const [menus, setMenus] = useState<HpbMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [slnId, setSlnId] = useState('');
  const [savedSlnId, setSavedSlnId] = useState<string | null>(null);
  const [savingSln, setSavingSln] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [applying, setApplying] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  const loadMenus = useCallback(async (fId: string) => {
    const res = await fetch(`/api/admin/hpb-menus?facility_id=${fId}`);
    if (!res.ok) throw new Error();
    const json = await res.json();
    setMenus((json.menus ?? []) as HpbMenu[]);
  }, []);

  const reload = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: membership, error: memErr } = await supabase
      .from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
    if (memErr && memErr.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
    if (!membership) { setLoading(false); return; }
    setFacilityId(membership.facility_id);

    const { data: profile, error: profErr } = await supabase
      .from('facility_profiles').select('hpb_sln_id').eq('id', membership.facility_id).single();
    if (profErr) { setLoadError(true); setLoading(false); return; }
    const sln = (profile?.hpb_sln_id as string | null) ?? null;
    setSavedSlnId(sln);
    setSlnId(sln ?? '');

    await loadMenus(membership.facility_id);
    setLoading(false);
  }, [loadMenus]);

  useEffect(() => {
    reload().catch(() => { setLoadError(true); setLoading(false); });
  }, [reload]);

  const handleSaveSln = async () => {
    if (!facilityId || savingSln) return;
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
      setToast({ type: 'success', message: '保存しました' });
    } catch {
      setToast({ type: 'error', message: '保存に失敗しました' });
    } finally {
      setSavingSln(false);
    }
  };

  const handleScrape = async () => {
    if (!facilityId || scraping) return;
    setScraping(true);
    try {
      const res = await fetch(`/api/admin/hpb-menus?facility_id=${facilityId}`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setToast({ type: 'error', message: json?.error || '取得に失敗しました' });
        return;
      }
      setToast({
        type: 'success',
        message: `取得 ${json.fetched}件中 ${json.saved}件を保存（スキップ${json.skipped} / 失敗${json.failed}）`,
      });
      await loadMenus(facilityId);
    } catch {
      setToast({ type: 'error', message: '取得に失敗しました' });
    } finally {
      setScraping(false);
    }
  };

  const handleApply = async () => {
    if (!facilityId || applying) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/admin/hpb-menus/apply?facility_id=${facilityId}`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setToast({ type: 'error', message: json?.error || '反映に失敗しました' });
        return;
      }
      setToast({
        type: 'success',
        message: `メニューへ反映: 新規${json.inserted}件（非公開で作成）/ 更新${json.updated}件 / 非表示化${json.hidden}件 / スキップ${json.skipped}件`,
      });
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
    });
  };

  const handleSaveEdit = async () => {
    if (!editForm || !facilityId || saving) return;
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
      await loadMenus(facilityId);
    } catch {
      setToast({ type: 'error', message: '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <AdminPageLoading />;

  return (
    <div>
      <SbPageHeader
        title="HPBメニュー取得"
        description="ホットペッパービューティーの予約ページから、メニュー名・施術時間・価格・内容を取得します。取得後の手直し（名前・時間・価格・非表示）は再取得しても消えません。"
      />

      {/* HPB 店舗ID 設定 */}
      <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
        <label htmlFor="hpb-sln" className="form-label">HPB 店舗ID（slnID）</label>
        <p className="text-xs text-gray-400 mb-2">
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
          <button type="button" onClick={handleSaveSln} disabled={savingSln} className="btn-primary px-5 !py-2.5 shrink-0">
            {savingSln ? '保存中...' : '保存'}
          </button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleScrape}
            disabled={scraping || !savedSlnId}
            className="btn-primary px-5 !py-2.5"
          >
            {scraping ? '取得中...' : 'HPBから取得'}
          </button>
          {!savedSlnId && <span className="text-xs text-gray-400">先に店舗IDを保存してください</span>}
        </div>
      </div>

      {/* メニュー一覧 */}
      {loadError ? (
        <LoadError onRetry={reload} message="HPBメニューの読み込みに失敗しました" />
      ) : menus.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-gray-400">まだ取得していません。店舗IDを保存して「HPBから取得」を押してください。</p>
        </div>
      ) : (
        <>
        <div className="bg-white rounded-xl shadow-sm p-5 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleApply}
              disabled={applying}
              className="btn-primary px-5 !py-2.5"
            >
              {applying ? '反映中...' : 'お客様メニューへ一括反映'}
            </button>
            <span className="text-xs text-gray-500">
              非表示を除く全件をお客様メニューへ反映します。反映したメニューは<b>非公開（下書き）</b>で作られ、
              メニュー編集で公開ONにするまでお客様には表示されません。
            </span>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm divide-y">
          {menus.map((m) => {
            const name = m.name_override ?? m.name;
            const dur = m.duration_min_override ?? m.duration_min;
            const price = m.price_override ?? m.price;
            const desc = m.description_override ?? m.description;
            const edited = m.name_override != null || m.duration_min_override != null || m.price_override != null || m.description_override != null;
            return (
              <div key={`${m.kind}-${m.ref_id}`} className={`flex items-start gap-4 p-4 ${m.is_hidden ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <SbBadge tone={m.kind === 'coupon' ? 'info' : 'neutral'}>{m.kind === 'coupon' ? 'クーポン' : 'メニュー'}</SbBadge>
                    {m.target && m.target !== '?' && <SbBadge tone="neutral">{m.target}</SbBadge>}
                    {m.is_hidden && <SbBadge tone="neutral">非表示</SbBadge>}
                    <p className="font-medium text-sm truncate">{name}</p>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {minutes(dur)} / {yen(price)}
                  </p>
                  {desc && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{desc}</p>}
                  {edited && (
                    <p className="text-[11px] text-amber-600 mt-1">手直し済（取得元: {m.name} / {minutes(m.duration_min)} / {yen(m.price)}）</p>
                  )}
                </div>
                <button type="button" onClick={() => startEdit(m)} className="p-2 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors shrink-0" aria-label="編集">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
              </div>
            );
          })}
        </div>
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
              <button type="button" onClick={() => setEditForm(null)} className="flex-1 py-2.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">キャンセル</button>
              <button type="button" onClick={handleSaveEdit} disabled={saving} className="btn-primary flex-1 !py-2.5">{saving ? '保存中...' : '保存'}</button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-gray-400">空欄にすると取得元の値に戻ります。手直しした値は再取得しても消えません。</p>
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
              <input type="checkbox" checked={editForm.is_hidden} onChange={(e) => setEditForm({ ...editForm, is_hidden: e.target.checked })} className="rounded border-gray-300 text-sky-500 focus:ring-sky-500" />
              <span className="text-sm">このメニューを使わない（非表示）</span>
            </label>
          </div>
        </Modal>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
