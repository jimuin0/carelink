'use client';

import { useState, useEffect, useRef } from 'react';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { SbPageHeader } from '@/components/admin/SbUi';
import RegistrationDuplicateLink from '@/components/admin/RegistrationDuplicateLink';
import ListingVerificationReview from '@/components/admin/ListingVerificationReview';
import ListingVerificationSearch from '@/components/admin/ListingVerificationSearch';
import ListingVerificationPending from '@/components/admin/ListingVerificationPending';
import { registrationListInput, registrationListResponse, type RegistrationListInput,
  type RegistrationCursor, type RegistrationListRow as Salon } from '@/lib/registration-list-contract';

export default function AdminRegistrationsPage() {
  const [salons, setSalons] = useState<Salon[]>([]);
  const [loading, setLoading] = useState(true);
  const [interactive, setInteractive] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmRejectSalon, setConfirmRejectSalon] = useState<Salon | null>(null);
  const [confirmApproveSalon, setConfirmApproveSalon] = useState<Salon | null>(null);
  const [confirmDeferSalon, setConfirmDeferSalon] = useState<Salon | null>(null);
  const [confirmDeleteSalon, setConfirmDeleteSalon] = useState<Salon | null>(null);
  const [filters, setFilters] = useState<RegistrationListInput>({ field: 'facility', query: '', status: 'all', cursor: null, visibility: 'visible' });
  const [query, setQuery] = useState('');
  const [field, setField] = useState<RegistrationListInput['field']>('facility');
  const [filterStatus, setFilterStatus] = useState<RegistrationListInput['status']>('all');
  const [visibility, setVisibility] = useState<RegistrationListInput['visibility']>('visible');
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
      setInteractive(true);
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
    setConfirmReject(false); setConfirmRejectSalon(null); setConfirmApproveSalon(null); setConfirmDeferSalon(null); setConfirmDeleteSalon(null); setToast(null);
  };
  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (mutationLock.current) return;
    const parsed = registrationListInput.safeParse({ field, query, status: filterStatus, cursor: null, visibility });
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
      setToast({ type: 'success', message: status === 'approved' && salon.source === 'register'
        ? `${salon.name}を承認しました。申込者へ続きの手順のメールを送ります（15分以内）。送信できたら Slack に通知します`
        : `${salon.name}を${label}として記録しました。公開・申込者への通知はされていません` });
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

  const updateClassification = async (salon: Salon, classification: 'test' | 'real' | 'unknown') => {
    if (mutationLock.current) return;
    mutationLock.current = true; setProcessingId(salon.id);
    const ownGeneration = generation.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`/api/admin/registrations/${salon.id}/classification`, {
        method: 'PATCH', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classification, expected_revision: salon.classification_revision }),
      });
      const result = await response.json();
      if (generation.current !== ownGeneration) return;
      if (!response.ok || result?.success !== true || result.classification !== classification || result.revision !== salon.classification_revision + 1) throw new Error('Unconfirmed update');
      setToast({ type: 'success', message: classification === 'test' ? 'テスト・検証用として記録しました' : classification === 'real' ? '本物の申込として記録しました' : '未確認として記録しました' });
      setReloadKey(key => key + 1);
    } catch {
      if (generation.current === ownGeneration) {
        uncertainRef.current = true; setMutationUncertain(true);
        setToast({ type: 'error', message: '区分の更新結果を確認できません。一覧を再読み込みしてください。' });
      }
    } finally {
      clearTimeout(timer); mutationLock.current = false;
      if (generation.current === ownGeneration) setProcessingId(null);
    }
  };

  const updateVisibility = async (salon: Salon, hidden: boolean) => {
    if (mutationLock.current) return;
    mutationLock.current = true; setProcessingId(salon.id);
    const ownGeneration = generation.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`/api/admin/registrations/${salon.id}/visibility`, {
        method: 'PATCH', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden }),
      });
      const result = await response.json();
      if (generation.current !== ownGeneration) return;
      if (!response.ok || result?.success !== true || result.hidden !== hidden) throw new Error('Unconfirmed update');
      setToast({ type: 'success', message: hidden ? `${salon.name}を一覧から隠しました。「一覧から隠した申込」から戻せます` : `${salon.name}を一覧に戻しました` });
      setReloadKey(key => key + 1);
    } catch {
      if (generation.current === ownGeneration) {
        uncertainRef.current = true; setMutationUncertain(true);
        setToast({ type: 'error', message: '表示の更新結果を確認できません。一覧を再読み込みしてください。' });
      }
    } finally {
      clearTimeout(timer); mutationLock.current = false;
      if (generation.current === ownGeneration) setProcessingId(null);
    }
  };

  const updateDeferral = async (salon: Salon, deferred: boolean) => {
    if (mutationLock.current) return;
    mutationLock.current = true; setProcessingId(salon.id);
    const ownGeneration = generation.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`/api/admin/registrations/${salon.id}/document-deferral`, {
        method: 'PATCH', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deferred }),
      });
      const result = await response.json();
      if (generation.current !== ownGeneration) return;
      if (response.status === 409 && typeof result?.error === 'string') { setToast({ type: 'error', message: result.error }); setReloadKey(key => key + 1); return; }
      if (!response.ok || result?.success !== true || result.deferred !== deferred) throw new Error('Unconfirmed update');
      setToast({ type: 'success', message: deferred ? `${salon.name}を「書類は後から」にしました。書類の確認前でも公開できます`
        : result.facilityPublished === true
          ? `${salon.name}を書類が先の扱いに戻しました。公開中の店舗はそのまま公開され、次に非公開にした後の再公開から書類の確認が必要です`
          : result.facilityPublished === false
            ? `${salon.name}は書類の確認が済んでから公開する扱いに戻しました`
            : `${salon.name}を書類が先の扱いに戻しました。すでに公開中の店舗は、非公開にするまでそのまま公開されます` });
      setReloadKey(key => key + 1);
    } catch {
      if (generation.current === ownGeneration) {
        uncertainRef.current = true; setMutationUncertain(true);
        setToast({ type: 'error', message: '書類の扱いの更新結果を確認できません。一覧を再読み込みしてください。' });
      }
    } finally {
      clearTimeout(timer); mutationLock.current = false;
      if (generation.current === ownGeneration) setProcessingId(null);
    }
  };
  const deleteTestRegistration = async () => {
    if (!confirmDeleteSalon || mutationLock.current) return;
    const salon = confirmDeleteSalon;
    setConfirmDeleteSalon(null);
    mutationLock.current = true; setProcessingId(salon.id);
    const ownGeneration = generation.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`/api/admin/registrations/${salon.id}/test-deletion`, {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_name: salon.name }),
      });
      const result = await response.json();
      if (generation.current !== ownGeneration) return;
      if (response.status === 409 && typeof result?.error === 'string') { setToast({ type: 'error', message: result.error }); setReloadKey(key => key + 1); return; }
      if (!response.ok || result?.success !== true) throw new Error('Unconfirmed deletion');
      setToast(result.filesRemoved === true
        ? { type: 'success', message: `${salon.name}を削除しました` }
        : { type: 'error', message: `${salon.name}を削除しましたが、写真のファイルが一部残っています` });
      setReloadKey(key => key + 1);
    } catch {
      if (generation.current === ownGeneration) {
        uncertainRef.current = true; setMutationUncertain(true);
        setToast({ type: 'error', message: '削除の結果を確認できません。一覧を再読み込みしてください。' });
      }
    } finally {
      clearTimeout(timer); mutationLock.current = false;
      if (generation.current === ownGeneration) setProcessingId(null);
    }
  };
  const doDefer = async () => {
    if (!confirmDeferSalon) return;
    const salon = confirmDeferSalon;
    setConfirmDeferSalon(null);
    await updateDeferral(salon, true);
  };

  const handleApprove = (salon: Salon) => setConfirmApproveSalon(salon);
  const doApprove = async () => {
    if (!confirmApproveSalon) return;
    const salon = confirmApproveSalon;
    setConfirmApproveSalon(null);
    await updateStatus(salon, 'approved');
  };

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

  const nextStep = (salon: Salon) => {
    if (salon.status === 'rejected') return salon.claimed_facility_id
      ? '却下済みです。この申込から作られた店舗は公開できません（すでに公開中の場合は、非公開になるまで公開が続きます）。'
      : '却下済みです。この申込からは店舗を作れません。';
    if (salon.claimed_facility_id) return salon.documents_deferred
      ? '申込者が店舗を作成済みです。「書類は後から」なので、営業時間などが揃えば書類の確認前でも公開できます。書類が届いたら、下の書類確認で確認してください。'
      : '申込者が店舗を作成済みです。下の書類確認で、提出された書類を確認してください（確認して記録すると、条件が揃っていれば公開されます）。';
    if (salon.status === 'approved') {
      if (salon.source !== 'register') return '承認済みです。この申込は掲載申込フォーム以外からのため、承認のメールは送られていません。';
      const waiting = '申込者が同じメールアドレスでログインして店舗を作成するのを待っています。';
      if (salon.approval_notice === 'sent') return `承認済みです。申込者へ続きの手順のメールを送信しました。${waiting}`;
      if (salon.approval_notice === 'queued') return `承認済みです。申込者へのメールは送信待ちです（15分以内）。${waiting}`;
      if (salon.approval_notice === 'uncertain') return '承認済みです。申込者へのメールは、送信を始めましたが届いたか確認できていません。送信記録を確かめるまで、個別の案内や再送はしないでください。';
      if (salon.approval_notice === 'failed') return '承認済みですが、申込者へのメールを送れませんでした。お問い合わせの返信などで、個別に続きの手順を案内してください。';
      return `承認済みですが、申込者へのメールは送っていません（メールの仕組みができる前の承認）。${waiting}`;
    }
    return salon.source === 'register'
      ? '内容を確認し、問題なければ「承認」してください。申込者へ続きの手順のメールが送られます。'
      : '内容を確認してください。この申込は掲載申込フォーム以外からのため、承認してもメールは送られません。';
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
      <section aria-labelledby="registration-flow" className="mb-4 rounded-xl bg-white p-4 text-sm leading-relaxed">
        <h2 id="registration-flow" className="font-bold mb-2">掲載までの流れ</h2>
        <ol className="list-decimal pl-5 space-y-1">
          <li><b>申込の受付</b>：申込者が掲載申込フォームから送信します。</li>
          <li><b>承認（運営）</b>：「承認」すると、申込者へ続きの手順を案内するメールが送られます（15分以内・同じ申込には1回だけ）。送信できたら Slack に通知します。<b>承認だけでは公開されません。</b></li>
          <li><b>店舗の作成（申込者）</b>：申込者が同じメールアドレスでログインし、店舗を作成します。</li>
          <li><b>書類の確認と公開（運営）</b>：店舗の作成後、この一覧の各申込の下に書類確認の欄が出ます。書類を確認して記録すると、店舗名・所在地・曜日ごとの営業時間が揃っていれば<b>そのまま公開されます</b>。揃っていなければ、申込者が設定を終えた時点で公開されます。</li>
        </ol>
        <p className="mt-2"><b>「書類は後から」</b>：すでにやりとりを進めていた店舗にだけ付けてください。付けた申込から作られた店舗は、書類の確認前でも公開でき、書類は公開後に提出してもらいます。</p>
        <p className="mt-2">「却下」すると、その申込からは店舗を作れなくなります（申込者への通知は送られません）。</p>
        <p className="mt-1">「一覧から隠す」は、この一覧の表示だけを変えます。申込・店舗・公開状態・通知は変わらず、データも削除しません。隠した申込は「表示する申込」で「一覧から隠した申込」を選ぶと確認でき、元に戻せます。</p>
        <p className="mt-1">「削除」は、申込の種類を「テスト・検証用」にした申込にだけ出ます。申込と下書きの店舗を完全に消し、元に戻せません。公開中の店舗や、予約・顧客・口コミ・確認書類がある店舗は消せません。</p>
      </section>
      <RegistrationDuplicateLink />
      <ListingVerificationPending />
      <ListingVerificationSearch />
      {mutationUncertain && <p role="alert">直前の更新結果が不明です。一覧の再取得に成功するまで、承認・却下はできません。</p>}
      <form onSubmit={applySearch} className="mb-5 space-y-3">
        <fieldset disabled={!interactive || processingId !== null} className="flex flex-wrap items-end gap-3">
          <label>検索項目<select aria-label="検索項目" value={field} onChange={event => setField(event.target.value as RegistrationListInput['field'])} className="form-input">
            <option value="facility">施設名</option><option value="receipt">受付番号</option><option value="email">メールアドレス</option>
          </select></label>
          <label>検索値<input aria-label="検索値" value={query} onChange={event => setQuery(event.target.value)} maxLength={254} className="form-input" /></label>
          <label>審査状態<select aria-label="審査状態" value={filterStatus} onChange={event => setFilterStatus(event.target.value as RegistrationListInput['status'])} className="form-input">
            <option value="all">すべて</option><option value="pending">審査中</option><option value="approved">承認済</option><option value="rejected">却下</option><option value="unknown">状態未設定</option>
          </select></label>
          <label>表示する申込<select aria-label="表示する申込" value={visibility} onChange={event => setVisibility(event.target.value as RegistrationListInput['visibility'])} className="form-input">
            <option value="visible">通常の申込</option><option value="hidden">一覧から隠した申込</option>
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
        <button type="button" disabled={!interactive || processingId !== null} onClick={() => { invalidate(); setReloadKey(key => key + 1); }}>一覧を再読み込み</button>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
        </div>
      ) : loadError ? (
        <LoadError onRetry={() => { invalidate(); setReloadKey((k) => k + 1); }} message="登録申請の読み込みに失敗しました。申込なしとは判定できません。" />
      ) : salons.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-500">{filters.visibility === 'hidden' ? '一覧から隠した申込はありません' : 'この条件・ページに該当する登録申請はありません'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {salons.map((salon) => {
            const st = statusLabel(salon.status);
            return (
              <div key={salon.id} className="bg-white rounded-xl p-4 shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.text}</span>
                      <span className="text-xs text-gray-500">
                        受付 {salon.created_at ? new Date(salon.created_at).toLocaleDateString('ja-JP') : '日時未設定'}
                      </span>
                      {salon.classification === 'test' && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">テスト・検証用</span>}
                      {salon.documents_deferred && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">書類は後から</span>}
                    </div>
                    <p className="text-lg font-bold break-words">{salon.name}</p>
                    <p className="text-sm mt-1"><span className="font-bold">次にすること：</span>{nextStep(salon)}</p>
                    <p className="text-xs">{salon.claimed_facility_id ? '店舗作成済み（公開状態は書類確認の欄で確認）' : salon.claimed_at ? '旧形式の取り込み記録あり・要照合' : '店舗作成前'}</p>
                    <p className="text-xs text-gray-500 mt-1 break-all">{salon.email}{salon.phone ? ` / ${salon.phone}` : ''}</p>
                    <p className="text-xs text-gray-500 break-all">受付番号：{salon.id}</p>
                  </div>
                  {salon.status === 'pending' && (
                    <div className="flex gap-2">
                      <button type="button" disabled={processingId !== null || mutationUncertain} onClick={() => handleApprove(salon)} className="text-sm bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">承認</button>
                      <button type="button" disabled={processingId !== null || mutationUncertain} onClick={() => handleReject(salon)} className="text-sm bg-red-100 text-red-700 px-4 py-2 rounded-lg hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed">却下</button>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-3 text-xs">
                  <span className="font-bold text-gray-700">運営メモ</span>
                  <label className="flex items-center gap-2">申込の種類
                    <select aria-label={`${salon.name}の申込の種類`} className="form-input" value={salon.classification ?? 'unknown'} disabled={processingId !== null || mutationUncertain} onChange={event => void updateClassification(salon, event.target.value as 'test' | 'real' | 'unknown')}>
                      <option value="unknown">未確認</option><option value="real">本物の申込</option><option value="test">テスト・検証用</option>
                    </select>
                  </label>
                  <span className="text-gray-500">見分け用のメモです。公開・通知には影響しません。</span>
                  <button type="button" className="underline disabled:opacity-50" disabled={processingId !== null || mutationUncertain} onClick={() => void updateVisibility(salon, !salon.hidden)}>{salon.hidden ? '一覧に戻す' : '一覧から隠す'}</button>
                  {(salon.documents_deferred || salon.status !== 'rejected') && <button type="button" className="underline disabled:opacity-50" disabled={processingId !== null || mutationUncertain}
                    onClick={() => salon.documents_deferred ? void updateDeferral(salon, false) : setConfirmDeferSalon(salon)}>
                    {salon.documents_deferred ? '書類を先に必須に戻す' : '書類は後からにする'}
                  </button>}
                  {salon.classification === 'test' && <button type="button" className="underline text-red-700 disabled:opacity-50" disabled={processingId !== null || mutationUncertain} onClick={() => setConfirmDeleteSalon(salon)}>{`${salon.name}を削除`}</button>}
                </div>
                {salon.claimed_facility_id && <ListingVerificationReview key={salon.claimed_facility_id} facilityId={salon.claimed_facility_id} />}
              </div>
            );
          })}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmDialog
        open={confirmDeleteSalon !== null}
        title="テスト用の申込を削除"
        message={`${confirmDeleteSalon?.name}を完全に削除しますか？${confirmDeleteSalon?.claimed_facility_id ? 'この申込から作られた下書きの店舗と、その写真も一緒に消えます。' : ''}元に戻せません。ログインアカウントは消えません。`}
        confirmLabel="削除する"
        variant="danger"
        onConfirm={deleteTestRegistration}
        onCancel={() => setConfirmDeleteSalon(null)}
      />
      <ConfirmDialog
        open={confirmDeferSalon !== null}
        title="書類は後からにする"
        message={`${confirmDeferSalon?.name}を「書類は後から」にしますか？この申込から作られた店舗は、運営が書類を確認する前でも公開できるようになります。すでにやりとりを進めていた店舗にだけ付けてください。`}
        confirmLabel="書類は後からにする"
        onConfirm={doDefer}
        onCancel={() => setConfirmDeferSalon(null)}
      />
      <ConfirmDialog
        open={confirmApproveSalon !== null}
        title="申込を承認"
        message={confirmApproveSalon?.source === 'register'
          ? `${confirmApproveSalon.name}を承認しますか？申込者（${confirmApproveSalon.email}）へ、続きの手順を案内するメールが送られます（15分以内・同じ申込には1回だけ）。承認だけでは公開されません。${confirmApproveSalon.documents_deferred ? '' : 'すでにやりとりを進めていた店舗なら、先に「書類は後からにする」を付けてから承認してください（メールの案内が「書類は公開後に提出」になります）。'}`
          : `${confirmApproveSalon?.name}を承認しますか？この申込は掲載申込フォーム以外からのため、メールは送られません。承認だけでは公開されません。`}
        confirmLabel="承認する"
        onConfirm={doApprove}
        onCancel={() => setConfirmApproveSalon(null)}
      />
      <ConfirmDialog
        open={confirmReject}
        title="施設を却下"
        message={`${confirmRejectSalon?.name}を却下しますか？${confirmRejectSalon?.claimed_facility_id ? 'この申込から作られた店舗は公開できなくなります（すでに公開中の場合は、非公開になるまで公開が続きます）。' : 'この申込からは店舗を作れなくなります。'}申込者への通知は送られません。`}
        confirmLabel="却下する"
        onConfirm={doReject}
        onCancel={() => { setConfirmReject(false); setConfirmRejectSalon(null); }}
      />
    </div>
  );
}
