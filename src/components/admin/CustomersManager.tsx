'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import Modal from '@/components/Modal';
import { SbInput, SbTable, SbThead, SbTh, SbTbody, SbTd } from '@/components/admin/SbUi';
import { csvEscape } from '@/lib/csv';

export interface MasterCustomer {
  id: string;
  name: string;
  name_kana: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  gender: string | null;
  notes: string | null;
  visit_count: number;
  last_visit: string | null;
  segment: string | null;
  total_spent: number | null;
  // 【監査M3】複数施設オーナー対応：各顧客が属する施設。編集/削除はこの facility_id を使う。
  facility_id: string;
  facility_name: string;
}

export interface Facility {
  id: string;
  name: string;
}

const SEGMENT_LABEL: Record<string, { label: string; className: string }> = {
  vip: { label: 'VIP', className: 'bg-amber-100 text-amber-800' },
  regular: { label: 'レギュラー', className: 'bg-sky-100 text-sky-700' },
  at_risk: { label: '離脱リスク', className: 'bg-orange-100 text-orange-700' },
  lost: { label: '離脱', className: 'bg-gray-100 text-gray-500' },
  new: { label: '新規', className: 'bg-green-100 text-green-700' },
};

export interface UnregisteredCustomer {
  name: string;
  email: string;
  visit_count: number;
  last_visit: string;
  // 【監査M3】未登録顧客も所属施設を持つ（「登録」時にその施設へ追加する）。
  facility_id: string;
  facility_name: string;
}

type FormState = {
  id: string | null;
  name: string;
  name_kana: string;
  email: string;
  phone: string;
  birthday: string;
  gender: string;
  notes: string;
  // 【監査M3】追加=セレクタで選んだ施設、編集=当該顧客の施設。CRUD はこの facility_id を使う。
  facility_id: string;
};

const EMPTY_FORM: FormState = { id: null, name: '', name_kana: '', email: '', phone: '', birthday: '', gender: '', notes: '', facility_id: '' };

const GENDER_LABEL: Record<string, string> = { male: '男性', female: '女性', other: 'その他' };

// HPB「お客様情報一覧」型の検索条件。CareLink の顧客マスターにある項目のみ（来店区分・年代・
// ダイレクト会員などデータ非保持の項目は除外）。
type SearchState = {
  name: string; kana: string; phone: string; email: string; gender: string;
  visitMin: string; visitMax: string; lastFrom: string; lastTo: string; birthday: string;
};
const EMPTY_SEARCH: SearchState = {
  name: '', kana: '', phone: '', email: '', gender: '',
  visitMin: '', visitMax: '', lastFrom: '', lastTo: '', birthday: '',
};
const includesCI = (v: string | null, q: string) => !q || (v ?? '').toLowerCase().includes(q.toLowerCase());

export default function CustomersManager({
  facilities,
  customers,
  unregistered,
}: {
  facilities: Facility[];
  customers: MasterCustomer[];
  unregistered: UnregisteredCustomer[];
}) {
  const router = useRouter();
  // 【監査M3】複数施設のとき一覧に施設列・追加フォームに施設セレクタを出す。単一施設は従来どおり。
  const multiFacility = facilities.length > 1;
  const defaultFacilityId = facilities[0]?.id ?? '';
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  // 削除は対象顧客の facility_id が必要なため {id, facility_id} で保持する。
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; facility_id: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // ステート更新が次レンダーまで反映されない隙の二重クリックも弾く同期ガード。
  const deletingRef = useRef(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // HPB お客様情報一覧型の検索（入力=draft、「検索する」で適用=search）。データはクライアントに
  // 全件あるため即時フィルタ（往復なし）。
  const [draft, setDraft] = useState<SearchState>(EMPTY_SEARCH);
  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH);
  const sd = (k: keyof SearchState) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const applySearch = () => setSearch(draft);
  const clearSearch = () => { setDraft(EMPTY_SEARCH); setSearch(EMPTY_SEARCH); };

  const matchCustomer = (c: MasterCustomer) =>
    includesCI(c.name, search.name) &&
    includesCI(c.name_kana, search.kana) &&
    includesCI(c.phone, search.phone) &&
    includesCI(c.email, search.email) &&
    (!search.gender || c.gender === search.gender) &&
    (!search.visitMin || c.visit_count >= Number(search.visitMin)) &&
    (!search.visitMax || c.visit_count <= Number(search.visitMax)) &&
    (!search.lastFrom || (!!c.last_visit && c.last_visit >= search.lastFrom)) &&
    (!search.lastTo || (!!c.last_visit && c.last_visit <= search.lastTo)) &&
    includesCI(c.birthday, search.birthday);
  const filtered = customers.filter(matchCustomer);
  // 未登録（来店履歴のみ）は名前・メールのみで突合（他項目は保持していない）。
  const filteredUnregistered = unregistered.filter((u) => includesCI(u.name, search.name) && includesCI(u.email, search.email));

  // 追加は既定施設（単一施設ならその施設・複数ならセレクタで変更可能）。prefill で施設を上書き可。
  const openCreate = (prefill?: Partial<FormState>) => setForm({ ...EMPTY_FORM, facility_id: defaultFacilityId, ...prefill });
  const openEdit = (c: MasterCustomer) =>
    setForm({
      id: c.id,
      name: c.name,
      name_kana: c.name_kana ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      birthday: c.birthday ?? '',
      gender: c.gender ?? '',
      notes: c.notes ?? '',
      facility_id: c.facility_id, // 編集は当該顧客の施設で固定（施設移動はしない）
    });

  const handleSave = async () => {
    if (!form) return;
    if (saving || !form.name.trim()) {
      setToast({ type: 'error', message: 'お名前は必須です' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        name_kana: form.name_kana.trim() || null,
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        birthday: form.birthday,
        gender: form.gender || null,
        notes: form.notes.trim() || null,
      };
      // 【監査M3】追加/編集とも form.facility_id（対象施設）を使う。
      const url = form.id
        ? `/api/admin/customers/${form.id}?facility_id=${form.facility_id}`
        : `/api/admin/customers?facility_id=${form.facility_id}`;
      const res = await fetch(url, {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '保存に失敗しました' });
        return;
      }
      setForm(null);
      setToast({ type: 'success', message: form.id ? '顧客情報を更新しました' : '顧客を追加しました' });
      router.refresh();
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/customers/${deleteTarget.id}?facility_id=${deleteTarget.facility_id}`, { method: 'DELETE' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '削除に失敗しました' });
        return;
      }
      setToast({ type: 'success', message: '顧客を削除しました' });
      router.refresh();
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      deletingRef.current = false;
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(
    '﻿' + 'お客様名,フリガナ,メール,電話,来店回数,最終来店\n' +
    customers
      .map((c) =>
        [c.name, c.name_kana ?? '', c.email ?? '', c.phone ?? '', c.visit_count, c.last_visit ?? '']
          .map(csvEscape)
          .join(','),
      )
      .join('\n')
  )}`;

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-2">
        {customers.length > 0 && (
          <a href={csvHref} download="customers.csv" className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            📥 CSV
          </a>
        )}
        <button type="button" onClick={() => openCreate()} className="btn-primary !py-2 !px-4 text-sm">
          ＋ 顧客を追加
        </button>
      </div>

      {/* 検索パネル（HPB お客様情報一覧型） */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">氏名</label>
            <SbInput value={draft.name} onChange={sd('name')} aria-label="氏名" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">フリガナ</label>
            <SbInput value={draft.kana} onChange={sd('kana')} aria-label="フリガナ" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">電話番号</label>
            <SbInput value={draft.phone} onChange={sd('phone')} aria-label="電話番号" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">メールアドレス</label>
            <SbInput value={draft.email} onChange={sd('email')} aria-label="メールアドレス" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">性別</label>
            <select value={draft.gender} onChange={sd('gender')} className="form-input" aria-label="性別">
              <option value="">すべて</option>
              <option value="male">男性</option>
              <option value="female">女性</option>
              <option value="other">その他</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">誕生日</label>
            <SbInput value={draft.birthday} onChange={sd('birthday')} aria-label="誕生日" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">来店回数</label>
            <div className="flex items-center gap-1">
              <SbInput type="number" value={draft.visitMin} onChange={sd('visitMin')} className="!w-20" aria-label="来店回数（最小）" />
              <span className="text-gray-400 text-sm">〜</span>
              <SbInput type="number" value={draft.visitMax} onChange={sd('visitMax')} className="!w-20" aria-label="来店回数（最大）" />
              <span className="text-gray-500 text-sm">回</span>
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">最終来店日</label>
            <div className="flex items-center gap-2">
              <SbInput type="date" value={draft.lastFrom} onChange={sd('lastFrom')} className="!w-auto" aria-label="最終来店日（開始）" />
              <span className="text-gray-400 text-sm">〜</span>
              <SbInput type="date" value={draft.lastTo} onChange={sd('lastTo')} className="!w-auto" aria-label="最終来店日（終了）" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button type="button" onClick={clearSearch} className="text-sm text-gray-500 hover:underline">条件をクリア</button>
          <button type="button" onClick={applySearch} className="btn-primary ml-auto !py-2.5 !px-8">検索する</button>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">登録済みの顧客がいません</p>
          <p className="text-xs text-gray-400 mt-1">「顧客を追加」から登録できます</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">条件に合う顧客がいません</p>
          <p className="text-xs text-gray-400 mt-1">「条件をクリア」で全件表示に戻せます</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <SbTable>
            <SbThead>
              <SbTh>お客様名</SbTh>
              {multiFacility && <SbTh>施設</SbTh>}
              <SbTh>連絡先</SbTh>
              <SbTh align="center">来店回数</SbTh>
              <SbTh>最終来店</SbTh>
              <SbTh align="center">セグメント</SbTh>
              <SbTh align="right">累計利用額</SbTh>
              <SbTh align="center">操作</SbTh>
            </SbThead>
            <SbTbody>
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <SbTd className="font-medium">
                    <a href={`/admin/customers/${c.id}`} className="text-sky-700 hover:underline">{c.name}</a>
                    {c.name_kana && <span className="block text-xs text-gray-400">{c.name_kana}</span>}
                    {c.gender && <span className="ml-1 text-xs text-gray-400">（{GENDER_LABEL[c.gender] ?? c.gender}）</span>}
                  </SbTd>
                  {multiFacility && <SbTd className="text-gray-500 text-xs">{c.facility_name}</SbTd>}
                  <SbTd className="text-gray-500 text-xs">
                    {c.email && <span className="block">{c.email}</span>}
                    {c.phone && <span className="block">{c.phone}</span>}
                    {!c.email && !c.phone && <span className="text-gray-300">—</span>}
                  </SbTd>
                  <SbTd align="center">{c.visit_count}回</SbTd>
                  <SbTd className="text-gray-500">{c.last_visit ?? '—'}</SbTd>
                  <SbTd align="center">
                    {c.segment && SEGMENT_LABEL[c.segment] ? (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${SEGMENT_LABEL[c.segment].className}`}>
                        {SEGMENT_LABEL[c.segment].label}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </SbTd>
                  <SbTd align="right" className="text-gray-700">
                    {c.total_spent !== null ? `¥${c.total_spent.toLocaleString()}` : '—'}
                  </SbTd>
                  <SbTd align="center">
                    <div className="flex items-center justify-center gap-1">
                      <button type="button" onClick={() => openEdit(c)} className="px-3 py-1.5 text-xs rounded border border-sky-200 text-sky-700 hover:bg-sky-50">編集</button>
                      <button type="button" onClick={() => setDeleteTarget({ id: c.id, facility_id: c.facility_id })} className="px-3 py-1.5 text-xs rounded border border-red-200 text-red-600 hover:bg-red-50">削除</button>
                    </div>
                  </SbTd>
                </tr>
              ))}
            </SbTbody>
          </SbTable>
        </div>
      )}

      {/* 来店履歴ありだがマスター未登録の顧客＝ワンクリックで登録フォームへ */}
      {filteredUnregistered.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-bold text-gray-700 mb-2">来店履歴から未登録のお客様</h2>
          <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
            <SbTable>
              <SbThead>
                <SbTh>お客様名</SbTh>
                <SbTh>メール</SbTh>
                <SbTh align="center">来店回数</SbTh>
                <SbTh>最終来店</SbTh>
                <SbTh align="center">操作</SbTh>
              </SbThead>
              <SbTbody>
                {filteredUnregistered.map((u) => (
                  <tr key={u.email || u.name} className="hover:bg-gray-50">
                    <SbTd className="font-medium">{u.name}</SbTd>
                    <SbTd className="text-gray-500">{u.email || '—'}</SbTd>
                    <SbTd align="center">{u.visit_count}回</SbTd>
                    <SbTd className="text-gray-500">{u.last_visit}</SbTd>
                    <SbTd align="center">
                      <button type="button" onClick={() => openCreate({ name: u.name, email: u.email, facility_id: u.facility_id })} className="px-3 py-1.5 text-xs rounded border border-sky-200 text-sky-700 hover:bg-sky-50">＋ 登録</button>
                    </SbTd>
                  </tr>
                ))}
              </SbTbody>
            </SbTable>
          </div>
        </div>
      )}

      {/* 追加・編集モーダル */}
      {form && (
        <Modal
          open={!!form}
          onClose={() => { if (!saving) setForm(null); }}
          title={form.id ? '顧客情報を編集' : '顧客を追加'}
          maxWidthClass="max-w-md"
          footer={
            <div className="flex gap-3">
              <button type="button" onClick={() => setForm(null)} disabled={saving} className="btn-outline flex-1 !py-2.5">キャンセル</button>
              <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1 !py-2.5">{saving ? '保存中...' : '保存する'}</button>
            </div>
          }
        >
            <div className="space-y-3">
              {/* 【監査M3】複数施設のとき対象施設を明示。追加=セレクタで選択、編集=当該顧客の施設で固定表示。 */}
              {multiFacility && (
                <div>
                  <label htmlFor="cust-facility" className="form-label">施設</label>
                  {form.id ? (
                    <p id="cust-facility" className="text-sm text-gray-700 py-2">{facilities.find((f) => f.id === form.facility_id)?.name ?? '施設'}</p>
                  ) : (
                    <select id="cust-facility" value={form.facility_id} onChange={(e) => setForm({ ...form, facility_id: e.target.value })} className="form-input">
                      {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  )}
                </div>
              )}
              <div>
                <label htmlFor="cust-name" className="form-label">お名前 <span className="text-red-500">*</span></label>
                <SbInput id="cust-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={50} />
              </div>
              <div>
                <label htmlFor="cust-kana" className="form-label">フリガナ</label>
                <SbInput id="cust-kana" value={form.name_kana} onChange={(e) => setForm({ ...form, name_kana: e.target.value })} maxLength={50} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cust-phone" className="form-label">電話番号</label>
                  <SbInput id="cust-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={20} />
                </div>
                <div>
                  <label htmlFor="cust-birthday" className="form-label">誕生日</label>
                  <SbInput id="cust-birthday" type="date" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })} />
                </div>
              </div>
              <div>
                <label htmlFor="cust-email" className="form-label">メールアドレス</label>
                <SbInput id="cust-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={254} />
              </div>
              <div>
                <label htmlFor="cust-gender" className="form-label">性別</label>
                <select id="cust-gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="form-input">
                  <option value="">未設定</option>
                  <option value="male">男性</option>
                  <option value="female">女性</option>
                  <option value="other">その他</option>
                </select>
              </div>
              <div>
                <label htmlFor="cust-notes" className="form-label">メモ・カルテ</label>
                <textarea id="cust-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="form-input" rows={3} maxLength={2000} />
                <p className="text-xs text-gray-400 mt-1">施術履歴・好み・注意事項などを自由に記入できます</p>
              </div>
            </div>
        </Modal>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="顧客を削除"
        message="この顧客をマスターから削除します。来店履歴（予約データ）は残ります。よろしいですか？"
        confirmLabel={deleting ? '削除中...' : '削除する'}
        confirmDisabled={deleting}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => { if (!deleting) setDeleteTarget(null); }}
      />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
