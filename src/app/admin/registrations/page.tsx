'use client';

import { useState, useEffect, useRef } from 'react';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { SbPageHeader } from '@/components/admin/SbUi';
import { registrationListInput, registrationListResponse, type RegistrationListInput,
  type RegistrationCursor, type RegistrationListRow as Salon } from '@/lib/registration-list-contract';

export default function AdminRegistrationsPage() {
  const [salons, setSalons] = useState<Salon[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmRejectSalon, setConfirmRejectSalon] = useState<Salon | null>(null);
  const [filters, setFilters] = useState<RegistrationListInput>({ field: 'facility', query: '', status: 'all', cursor: null });
  const [query, setQuery] = useState('');
  const [field, setField] = useState<RegistrationListInput['field']>('facility');
  const [filterStatus, setFilterStatus] = useState<RegistrationListInput['status']>('all');
  const [nextCursor, setNextCursor] = useState<RegistrationCursor | null>(null);
  const [previous, setPrevious] = useState<(RegistrationCursor | null)[]>([]);
  const [searchError, setSearchError] = useState('');
  const generation = useRef(0);
  const mutationLock = useRef(false);
  const [mutationUncertain, setMutationUncertain] = useState(false);
  const uncertainRef = useRef(false);

  // React Compiler の set-state-in-effect 対策：取得処理を useCallback 関数として effect の
  // 依存に置き外部から直接呼ぶのではなく、effect 内に inline した非同期IIFEとして定義する
  // （React 公式が推奨する形）。再取得（リトライ・承認/却下後の一覧更新）は関数呼び出しではなく
  // reloadKey をインクリメントして effect を再発火させる形に統一し、取得ロジックの二重定義を避ける。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const generationRef = generation;
    const ownGeneration = ++generationRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await fetch('/api/admin/registrations', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filters), signal: controller.signal });
        const parsed = registrationListResponse.safeParse(await res.json());
        if (!res.ok || !parsed.success) throw new Error('Registration list unavailable');
        if (generation.current !== ownGeneration) return;
        setSalons(parsed.data.salons); setNextCursor(parsed.data.nextCursor);
        uncertainRef.current = false; setMutationUncertain(false);
      } catch {
        if (generation.current !== ownGeneration) return;
        setLoadError(true); setNextCursor(null);
      } finally {
        clearTimeout(timer);
        if (generation.current === ownGeneration) setLoading(false);
      }
    })();
    return () => { ++generationRef.current; controller.abort(); clearTimeout(timer); };
  }, [filters, reloadKey]);

  const invalidate = () => {
    ++generation.current; setLoading(true); setLoadError(false); setNextCursor(null);
    setConfirmReject(false); setConfirmRejectSalon(null); setToast(null);
  };
  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (mutationLock.current) return;
    const parsed = registrationListInput.safeParse({ field, query, status: filterStatus, cursor: null });
    if (!parsed.success) { setSearchError('検索条件を確認してください。受付番号はUUID、施設名は200文字以内です。'); return; }
    invalidate(); setSearchError(''); setPrevious([]); setFilters(parsed.data);
  };
  const nextPage = () => {
    if (loading || mutationLock.current || !nextCursor) return;
    const cursor = nextCursor; invalidate();
    setPrevious(current => [...current, filters.cursor]); setFilters(current => ({ ...current, cursor }));
  };
  const previousPage = () => {
    if (loading || mutationLock.current || previous.length === 0) return;
    const cursor = previous[previous.length - 1]; invalidate();
    setPrevious(current => current.slice(0, -1)); setFilters(current => ({ ...current, cursor }));
  };

  const updateStatus = async (salon: Salon, status: 'approved' | 'rejected') => {
    if (mutationLock.current || uncertainRef.current || loading || loadError) return;
    mutationLock.current = true;
    setProcessingId(salon.id);
    const ownGeneration = generation.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(`/api/admin/registrations/${salon.id}`, {
        method: 'PATCH',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, expected_status: salon.status, expected_revision: salon.review_revision }),
      });
      const result = await res.json();
      if (generation.current !== ownGeneration) return;
      if (!res.ok || result?.success !== true) {
        uncertainRef.current = true; setMutationUncertain(true);
        const label = status === 'approved' ? '承認' : '却下';
        setToast({ type: 'error', message: `${label}結果を確認できませんでした。一覧を再読み込みして確認してください。` });
        return;
      }
      const label = status === 'approved' ? '承認' : '却下';
      setToast({ type: 'success', message: `${salon.name}を${label}しました` });
      setReloadKey((k) => k + 1);
    } catch {
      if (generation.current === ownGeneration) {
        uncertainRef.current = true; setMutationUncertain(true);
        setToast({ type: 'error', message: '更新結果を確認できませんでした。一覧を再読み込みして確認してください。' });
      }
    } finally {
      clearTimeout(timer); mutationLock.current = false;
      if (generation.current === ownGeneration) setProcessingId(null);
    }
  };

  const handleApprove = (salon: Salon) => updateStatus(salon, 'approved');

  const handleReject = (salon: Salon) => {
    setConfirmRejectSalon(salon);
    setConfirmReject(true);
  };

  const doReject = async () => {
    if (!confirmRejectSalon) return;
    setConfirmReject(false);
    const salon = confirmRejectSalon;
    setConfirmRejectSalon(null);
    await updateStatus(salon, 'rejected');
  };

  const statusLabel = (s: string | null) => {
    switch (s) {
      case 'pending': return { text: '審査中', cls: 'bg-yellow-100 text-yellow-700' };
      case 'approved': return { text: '承認済', cls: 'bg-green-100 text-green-700' };
      case 'rejected': return { text: '却下', cls: 'bg-red-100 text-red-700' };
      default: return { text: s || '状態未設定', cls: 'bg-gray-100 text-gray-700' };
    }
  };

  return (
    <div>
      <SbPageHeader title="施設登録管理" />
      <p className="text-sm mb-4">審査の承認は一般公開の完了ではありません。店舗作成後に公開条件を確認してください。</p>
      {mutationUncertain && <p role="alert">直前の更新結果が不明です。一覧の再取得に成功するまで、承認・却下はできません。</p>}
      <form onSubmit={applySearch} className="mb-5 space-y-3">
        <fieldset disabled={processingId !== null} className="flex flex-wrap items-end gap-3">
          <label>検索項目<select aria-label="検索項目" value={field} onChange={event => setField(event.target.value as RegistrationListInput['field'])} className="form-input">
            <option value="facility">施設名</option><option value="receipt">受付番号</option><option value="email">メールアドレス</option>
          </select></label>
          <label>検索値<input aria-label="検索値" value={query} onChange={event => setQuery(event.target.value)} maxLength={254} className="form-input" /></label>
          <label>審査状態<select aria-label="審査状態" value={filterStatus} onChange={event => setFilterStatus(event.target.value as RegistrationListInput['status'])} className="form-input">
            <option value="all">すべて</option><option value="pending">審査中</option><option value="approved">承認済</option><option value="rejected">却下</option><option value="unknown">状態未設定</option>
          </select></label>
          <button type="submit" className="btn-primary">検索する</button>
        </fieldset>
        <p className="text-xs text-gray-500">検索値は保存値との完全一致（大小文字も区別）です。空欄では全申込を50件ずつ表示します。</p>
        {searchError && <p role="alert">{searchError}</p>}
      </form>
      <div className="flex gap-3 items-center mb-4">
        <button type="button" disabled={loading || processingId !== null || previous.length === 0} onClick={previousPage}>前の50件</button>
        <span>{previous.length + 1}ページ目</span>
        <button type="button" disabled={loading || processingId !== null || !nextCursor} onClick={nextPage}>次の50件</button>
        <button type="button" disabled={processingId !== null} onClick={() => { invalidate(); setReloadKey(key => key + 1); }}>一覧を再読み込み</button>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
        </div>
      ) : loadError ? (
        <LoadError onRetry={() => { invalidate(); setReloadKey((k) => k + 1); }} message="登録申請の読み込みに失敗しました。申込なしとは判定できません。" />
      ) : salons.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">この条件・ページに該当する登録申請はありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {salons.map((salon) => {
            const st = statusLabel(salon.status);
            return (
              <div key={salon.id} className="bg-white rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.text}</span>
                      <span className="text-xs text-gray-400">
                        {salon.created_at ? new Date(salon.created_at).toLocaleDateString('ja-JP') : '受付日時未設定'}
                      </span>
                    </div>
                    <p className="font-bold">{salon.name}</p>
                    <p className="text-xs break-all">受付番号：{salon.id}</p>
                    <p className="text-xs">{salon.claimed_facility_id ? '店舗作成済み（公開状態は別途確認）' : salon.claimed_at ? '旧形式の取り込み記録あり・要照合' : '店舗作成前'}</p>
                    <p className="text-xs text-gray-500">{salon.email}{salon.phone ? ` / ${salon.phone}` : ''}</p>
                  </div>
                  {salon.status === 'pending' && (
                    <div className="flex gap-2">
                      <button type="button" disabled={processingId !== null || mutationUncertain} onClick={() => handleApprove(salon)} className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed">承認</button>
                      <button type="button" disabled={processingId !== null || mutationUncertain} onClick={() => handleReject(salon)} className="text-xs bg-red-100 text-red-600 px-3 py-1 rounded-lg hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed">却下</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmDialog
        open={confirmReject}
        title="施設を却下"
        message={`${confirmRejectSalon?.name}を却下しますか？`}
        confirmLabel="却下する"
        onConfirm={doReject}
        onCancel={() => { setConfirmReject(false); setConfirmRejectSalon(null); }}
      />
    </div>
  );
}
