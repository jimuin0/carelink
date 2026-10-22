'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { verifyAuthUser } from '@/lib/auth-verification';
import { businessTypes, facilityFeatures, prefectures, dayOrder, dayLabels } from '@/lib/constants';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { SbPageHeader, SbBadge, SbInput } from '@/components/admin/SbUi';
import dynamic from 'next/dynamic';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import { FACILITY_INPUT_LIMITS } from '@/lib/facility-input-limits';
import { GBP_IDENTITY_CHANGE_NOTICE } from '@/lib/gbp-ownership';
import { hasConfirmedBookingHours } from '@/lib/booking-preparation';
import { copyFirstHoursToOpenDays, initialHoursForm, validateHoursForm, type HoursDraft } from '@/lib/business-hours-form';
import { normalizeWebsiteUrl } from '@/lib/facility-settings-input';
import { facilitySetupSteps, loadFacilitySetupFacts, type FacilitySetupStep } from '@/lib/facility-setup-steps';
import { listingPublishMissing } from '@/lib/facility-publish-gate';
import FacilitySelector, { loadAdminFacilitySelection, type AdminFacilityChoice } from '@/components/admin/FacilitySelector';
import { BOOKING_CSV_MAX_ROWS, buildBookingCsv, readBookingCsvRows } from '@/lib/booking-csv-export';
import { businessTypeLabel } from '@/lib/business-type-label';

const NotificationSettings = dynamic(() => import('@/components/admin/NotificationSettings'), { ssr: false });
const CancelPolicySettings = dynamic(() => import('@/components/admin/CancelPolicySettings'), { ssr: false });
const WithdrawalSettings = dynamic(() => import('@/components/admin/WithdrawalSettings'), { ssr: false });
const ReminderUpsellSettings = dynamic(() => import('@/components/admin/ReminderUpsellSettings'), { ssr: false });

// facility_profiles.status は DEFAULT 'draft' + CHECK (status IN ('draft','published','suspended')) で
// NOT NULL ではないため null もあり得るし、CHECK 制約は Supabase の型生成に反映されないため
// 生成型は単なる string | null になる。ランタイムでも安全に絞り込み、null・想定外の値は
// 既定値の 'draft' に倒す（元々の `data.status || 'draft'` と同じフォールバック方針を維持）。
function toFacilityStatus(v: string | null): 'draft' | 'published' | 'suspended' {
  return v === 'draft' || v === 'published' || v === 'suspended' ? v : 'draft';
}

function AdminSettingsContent() {
  const requestedFacility = useSearchParams().get('facility_id');
  const [facilityChoices, setFacilityChoices] = useState<AdminFacilityChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  const [saving, setSaving] = useState(false);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  // 保存を断られた欄ごとの理由（API のキー → 文言）。欄の下に出す（トーストは数秒で消える）。
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const [csvExporting, setCsvExporting] = useState(false);
  // 予約 CSV を上限で切り捨てたときの注記。トーストは 4 秒で消えるので、見落とさないよう画面に残す。
  const [csvTruncated, setCsvTruncated] = useState(false);

  // Basic info
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [catchCopy, setCatchCopy] = useState('');
  const [description, setDescription] = useState('');

  // Location
  const [postalCode, setPostalCode] = useState('');
  const [prefecture, setPrefecture] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [building, setBuilding] = useState('');
  const [accessInfo, setAccessInfo] = useState('');
  const [nearestStation, setNearestStation] = useState('');

  // Contact
  const [phone, setPhone] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState('');

  // Details
  const [seatCount, setSeatCount] = useState('');
  const [staffCount, setStaffCount] = useState('');
  const [parking, setParking] = useState(false);
  const [creditCard, setCreditCard] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [regularHoliday, setRegularHoliday] = useState('');
  const [facilityStatus, setFacilityStatus] = useState<'draft' | 'published' | 'suspended'>('draft');
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  // サロンボードの時間軸の区切り幅（分）。既定 60。
  const [boardSlotMinutes, setBoardSlotMinutes] = useState(60);
  const [publishToggling, setPublishToggling] = useState(false);
  // 「公開する」を押したときに足りなかった項目。トーストは数秒で消えるので画面に残す。
  // source＝画面の入力で確かめた結果（visible）か、保存済みの内容でサーバーが断った結果（saved）か。
  const [publishMissing, setPublishMissing] = useState<{ source: 'visible' | 'saved'; items: string[] } | null>(null);
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);

  // Business hours。未保存の店舗は空欄から始める（09:00〜19:00 などの既定値を黙って入れない）。
  const [hours, setHours] = useState<HoursDraft>(() => initialHoursForm(null).hours);
  const [closedDays, setClosedDays] = useState<string[]>([]);
  // 保存済みの営業時間が7曜日そろっているか（そろっていれば、保存のたびにそのまま送り直す）。
  const [hoursConfirmed, setHoursConfirmed] = useState(false);
  // 画面で営業時間を触ったか。触ったら、それを確認とみなして保存する（黙って捨てない）。
  const [hoursEdited, setHoursEdited] = useState(false);
  const [submittedHoursText, setSubmittedHoursText] = useState('');

  // ネット予約の準備状況（保存済みの内容で判定）。ダッシュボードの「ネット予約の準備内容を確認する」の行き先。
  const [readiness, setReadiness] = useState<{ state: 'loading' | 'error' } | { state: 'ready'; steps: FacilitySetupStep[] }>({ state: 'loading' });
  const [readinessKey, setReadinessKey] = useState(0);

  // React Compiler の set-state-in-effect 対策：取得処理を useCallback 関数として effect の
  // 依存に置き外部から直接呼ぶのではなく、effect 内に inline した非同期IIFEとして定義する
  // （React 公式が推奨する形）。再取得（リトライ）は関数呼び出しではなく reloadKey を
  // インクリメントして effect を再発火させる形に統一し、取得ロジックの二重定義を避ける。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createBrowserSupabaseClient();
      setLoading(true);
      setFacilityId(null);
      setFacilityChoices([]);
      setLoadError(false);
      setPublishMissing(null);
      const verification = await verifyAuthUser(supabase.auth);
      if (!active) return;
      if (verification.state === 'unavailable') { setLoadError(true); setLoading(false); return; }
      if (verification.state !== 'verified') { setLoading(false); return; }
      const user = verification.user;
      const selection = await loadAdminFacilitySelection(supabase, user.id, requestedFacility);
      if (!active) return;
      setFacilityChoices(selection.choices);
      if (!selection.selectedId) { setLoading(false); return; }
      const { data, error } = await supabase.from('facility_profiles').select('*').eq('id', selection.selectedId).single();
      if (!active) return;
      if (error) { setLoadError(true); setLoading(false); return; }
      if (!data) { setLoadError(true); setLoading(false); return; }
      setFacilityId(selection.selectedId);
      setDirty(false);
      if (data) {
        setName(data.name || '');
        setBusinessType(data.business_type || '');
        setCatchCopy(data.catch_copy || '');
        setDescription(data.description || '');
        setPostalCode(data.postal_code || '');
        setPrefecture(data.prefecture || '');
        setCity(data.city || '');
        setAddress(data.address || '');
        setBuilding(data.building || '');
        setAccessInfo(data.access_info || '');
        setNearestStation(data.nearest_station || '');
        setPhone(data.phone || '');
        setSlug(data.slug || null);
        setWebsiteUrl(data.website_url || '');
        setSeatCount(data.seat_count?.toString() || '');
        setStaffCount(data.staff_count?.toString() || '');
        setParking(data.parking ?? false);
        setCreditCard(data.credit_card ?? false);
        setSelectedFeatures(data.features || []);
        setRegularHoliday(data.regular_holiday || '');
        setFacilityStatus(toFacilityStatus(data.status));
        setAutoConfirm(data.booking_auto_confirm ?? false);
        setBufferMinutes(data.booking_buffer_minutes ?? 0);
        setBoardSlotMinutes(data.board_slot_minutes ?? 60);
        setSubmittedHoursText(data.business_hours_text || '');
        setHoursConfirmed(hasConfirmedBookingHours(data.business_hours));
        setHoursEdited(false);
        const form = initialHoursForm(data.business_hours);
        setHours(form.hours);
        setClosedDays(form.closedDays);
      }
      setLoading(false);
    })().catch(() => { if (active) { setLoadError(true); setLoading(false); } });
    return () => { active = false; };
  }, [reloadKey, requestedFacility]);

  useEffect(() => {
    if (!facilityId) return;
    let active = true;
    (async () => {
      setReadiness({ state: 'loading' });
      const facts = await loadFacilitySetupFacts(createBrowserSupabaseClient(), facilityId);
      if (active) setReadiness({ state: 'ready', steps: facilitySetupSteps(facts) });
    })().catch(() => { if (active) setReadiness({ state: 'error' }); });
    return () => { active = false; };
  }, [facilityId, readinessKey]);

  const toggleFeature = (f: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]
    );
    // 特徴ピルは <button>(onClick) のため、フォームの <div onChange> 経由では dirty にならない。
    // 未保存ガードをすり抜けて編集が黙って失われるのを防ぐため、ここで明示的に dirty を立てる。
    setDirty(true);
  };

  const toggleClosed = (day: string) => {
    setClosedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
    setHoursEdited(true);
  };

  const updateHour = (day: string, field: 'open' | 'close', value: string) => {
    setHours((prev) => ({
      ...prev,
      [day]: { ...(prev[day] ?? { open: '', close: '' }), [field]: value },
    }));
    setHoursEdited(true);
  };

  const copyHours = () => {
    const next = copyFirstHoursToOpenDays(hours, closedDays);
    if (!next) {
      setToast({ type: 'error', message: '先にいずれかの曜日の開店・閉店時間を入力してください' });
      return;
    }
    setHours(next);
    setHoursEdited(true);
    setDirty(true);
  };

  /** 画面の入力を保存する。保存できたときだけ true（公開はこの結果を見てから行う）。 */
  const saveSettings = async (): Promise<boolean> => {
    if (saving || !facilityId) return false;
    // 施設名が空のまま押しても何も起きなかった。理由を示して欄へ移る。
    if (!name.trim()) {
      setFieldErrors({ name: '施設名を入力してください' });
      setToast({ type: 'error', message: '施設名を入力してください' });
      nameRef.current?.focus();
      return false;
    }

    // 営業時間：保存済みのもの、または画面で触ったものだけを送る。送るなら7曜日すべてを検査し、
    // 保存できない入力なら保存全体を止める（営業時間だけ黙って捨てて「保存しました」と出さない）。
    const sendHours = hoursConfirmed || hoursEdited;
    const checkedHours = sendHours ? validateHoursForm(hours, closedDays) : null;
    if (checkedHours && !checkedHours.ok) {
      setFieldErrors({ business_hours: checkedHours.message });
      setToast({ type: 'error', message: checkedHours.message });
      return false;
    }
    const website = normalizeWebsiteUrl(websiteUrl) as string;

    setFieldErrors({});
    setSaving(true);
    try {

      const res = await fetch(`/api/admin/settings?facility_id=${facilityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          business_type: businessType,
          catch_copy: catchCopy || null,
          description: description || null,
          postal_code: postalCode || null,
          prefecture,
          city,
          address,
          building: building || null,
          access_info: accessInfo || null,
          nearest_station: nearestStation || null,
          phone: phone || null,
          website_url: website || null,
          seat_count: seatCount ? parseInt(seatCount, 10) : null,
          staff_count: staffCount ? parseInt(staffCount, 10) : null,
          parking,
          credit_card: creditCard,
          features: selectedFeatures,
          regular_holiday: regularHoliday || null,
          ...(checkedHours?.ok ? { business_hours: checkedHours.value } : {}),
          booking_auto_confirm: autoConfirm,
          booking_buffer_minutes: bufferMinutes,
          board_slot_minutes: boardSlotMinutes,
        }),
      });

      const result = await res.json().catch(() => null);
      if (!res.ok || result?.ok !== true) {
        if (result?.fields && typeof result.fields === 'object') setFieldErrors(result.fields as Record<string, string>);
        setToast({ type: 'error', message: result?.error || '保存結果を確認できませんでした。入力内容を保持しています' });
        return false;
      }
      setWebsiteUrl(website);
      if (checkedHours?.ok) { setHoursConfirmed(true); setHoursEdited(false); }
      // サーバーは市区町村をエリアの単位へ揃える（例: 横浜市中区 → 横浜市＋番地「中区…」）。
      // 入力欄を保存された値に合わせ、次の保存で古い表記を送り直さないようにする。
      if (typeof result.location?.city === 'string' && typeof result.location?.address === 'string') {
        setCity(result.location.city);
        setAddress(result.location.address);
      }
      setDirty(false);
      // 保存で中身が変わったので、前回の「足りない項目」は古い。次に公開を押したときに改めて確かめる。
      setPublishMissing(null);
      setReadinessKey((k) => k + 1);
      setToast({
        type: 'success',
        message: sendHours
          ? '施設情報を保存しました'
          : '施設情報を保存しました。営業時間はまだ入力されていないため、ネット予約は始まりません',
      });
      return true;
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
      return false;
    } finally {
      setSaving(false);
    }
  };
  const handleSave = () => { void saveSettings(); };

  /**
   * 「公開する」。公開ゲートは保存済みの内容を読むため、以前は画面に入力したばかりの住所を
   * 「未設定」として拒否していた（保存を押してから公開すれば通るので、壊れて見えた）。
   * まず画面に見えている内容をサーバーと同じ規則（listingPublishMissing）で確かめ、
   * 足りない項目をその場で一覧にする。未保存の入力があれば先に保存し、保存できたときだけ公開する。
   */
  const handlePublish = async () => {
    if (!facilityId || publishToggling || saving) return;
    const visibleMissing = listingPublishMissing({ name, prefecture, city, address, catch_copy: catchCopy, description });
    if (visibleMissing.length > 0) { setPublishMissing({ source: 'visible', items: visibleMissing }); return; }
    setPublishMissing(null);
    setPublishToggling(true);
    // 通信エラーで fetch が throw してもボタンが「処理中...」のまま固着しないよう
    // try/finally で必ずトグル状態を解除し、失敗はトーストで明示する。
    try {
      if (dirty && !(await saveSettings())) return;
      const res = await fetch(`/api/admin/settings?facility_id=${facilityId}&action=status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published' }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok === true) {
        setFacilityStatus('published');
        setReadinessKey((k) => k + 1);
        setToast({ type: 'success', message: '施設を公開しました！' });
        return;
      }
      // サーバは不足項目を missing 配列で返す。これを捨てて「失敗しました」だけ出すと、
      // 何を揃えれば公開できるか分からないため、画面に一覧で残す（トーストは数秒で消える）。
      const missing = Array.isArray(body?.missing) ? (body.missing as unknown[]).filter((m): m is string => typeof m === 'string') : [];
      setPublishMissing(missing.length > 0 ? { source: 'saved', items: missing } : null);
      setToast({ type: 'error', message: missing.length > 0 ? '公開できませんでした。足りない項目を確認してください' : (body?.error || '公開に失敗しました') });
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setPublishToggling(false);
    }
  };

  if (loading) return <AdminPageLoading />;

  // 取得失敗時はフォームを描画しない（空フォームを保存して実データを上書きする事故を防ぐ）
  if (loadError) {
    return (
      <div>
        <SbPageHeader title="施設設定" />
        <LoadError onRetry={() => setReloadKey((k) => k + 1)} message="施設情報の読み込みに失敗しました" />
      </div>
    );
  }

  if (!facilityId) return <FacilitySelector choices={facilityChoices} selectedId={null} path="/admin/settings" />;

  return (
    <div onChange={() => setDirty(true)}>
      <FacilitySelector choices={facilityChoices} selectedId={facilityId} path="/admin/settings" dirty={dirty} busy={saving || publishToggling} />
      <p className="mb-4 text-sm text-gray-600">無料掲載とネット予約は別です。所在地などの店舗情報を確認して掲載公開できます。ネット予約は、公開メニュー・写真・勤務時間を保存したスタッフ・全曜日の営業時間設定がそろうまで利用できません。予約管理表は引き続き利用できます。</p>
      <SbPageHeader
        title="施設設定"
        actions={
          <>
            <SbBadge tone={facilityStatus === 'published' ? 'success' : 'neutral'}>
              {facilityStatus === 'published' ? '公開中' : '非公開'}
            </SbBadge>
            <button
              type="button"
              onClick={() => {
                if (facilityStatus === 'published') { setShowUnpublishConfirm(true); return; }
                void handlePublish();
              }}
              disabled={publishToggling || saving || !facilityId}
              className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors ${facilityStatus === 'published' ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-green-700 text-white hover:bg-green-800'}`}
            >
              {publishToggling ? '処理中...' : facilityStatus === 'published' ? '非公開にする' : dirty ? '保存して公開する' : '公開する'}
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="btn-primary px-6 py-2.5!">
              {saving ? '保存中...' : '保存する'}
            </button>
          </>
        }
      />

      {facilityStatus === 'published' && slug && (
        <p className="mb-4 text-sm">
          <Link href={`/facility/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer" className="font-bold text-sky-700 underline">掲載ページを見る</Link>
          <span className="ml-2 text-gray-600">（お客様に表示されている内容を確認できます）</span>
        </p>
      )}

      <BookingReadinessSection readiness={readiness} facilityId={facilityId} onRetry={() => setReadinessKey((k) => k + 1)} />

      {publishMissing && facilityStatus !== 'published' && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
          {/* 一覧には未入力だけでなく、直す必要のある PR 文言の表現も並ぶ。サーバーが保存済みの内容で
              断ったときは、画面では入力済みに見える欄が並び得るので、そのことを先に伝える。 */}
          <p className="text-sm font-bold text-red-800">
            {publishMissing.source === 'saved'
              ? '保存済みの内容では次の点が足りないため、公開できませんでした。'
              : '公開するには、次の点を直してください。'}
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
            {publishMissing.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      {/* 基本情報 */}
      <section className="bg-white rounded-xl shadow-xs p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">基本情報</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="fac-name" className="form-label">施設名 <span className="text-red-500">*</span></label>
            <SbInput ref={nameRef} id="fac-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={FACILITY_INPUT_LIMITS.name}
              aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={fieldErrors.name ? 'fac-name-error' : undefined} />
            <FieldError id="fac-name-error" message={fieldErrors.name} />
          </div>
          <div>
            <label htmlFor="fac-type" className="form-label">業種 <span className="text-red-500">*</span></label>
            <select id="fac-type" value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="form-input">
              <option value="">選択してください</option>
              {businessTypes.map((t) => <option key={t} value={t}>{businessTypeLabel(t)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="fac-catch" className="form-label">キャッチコピー</label>
            <SbInput id="fac-catch" value={catchCopy} onChange={(e) => setCatchCopy(e.target.value)} maxLength={200} placeholder="例: 駅チカ3分！丁寧なカウンセリング"
              aria-invalid={fieldErrors.catch_copy ? true : undefined} aria-describedby={fieldErrors.catch_copy ? 'fac-catch-error' : undefined} />
            <FieldError id="fac-catch-error" message={fieldErrors.catch_copy} />
          </div>
          <div>
            <label htmlFor="fac-desc" className="form-label">施設紹介</label>
            <textarea id="fac-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="form-input" rows={5} maxLength={2000}
              aria-invalid={fieldErrors.description ? true : undefined} aria-describedby={fieldErrors.description ? 'fac-desc-error' : undefined} />
            <FieldError id="fac-desc-error" message={fieldErrors.description} />
          </div>
        </div>
      </section>

      {/* 所在地 */}
      <section className="bg-white rounded-xl shadow-xs p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">所在地</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fac-zip" className="form-label">郵便番号</label>
              <SbInput id="fac-zip" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="123-4567" maxLength={8} />
            </div>
            <div>
              <label htmlFor="fac-pref" className="form-label">都道府県 <span className="text-red-500">*</span></label>
              <select id="fac-pref" value={prefecture} onChange={(e) => setPrefecture(e.target.value)} className="form-input">
                <option value="">選択</option>
                {prefectures.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fac-city" className="form-label">市区町村 <span className="text-red-500">*</span></label>
              <SbInput id="fac-city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={FACILITY_INPUT_LIMITS.city} />
            </div>
            <div>
              {/* 公開には町名から入っている必要がある（番地の数字だけでは来店先が分からない）。 */}
              <label htmlFor="fac-addr" className="form-label">町名・番地 <span className="text-red-500">*</span></label>
              <SbInput id="fac-addr" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={FACILITY_INPUT_LIMITS.address} placeholder="例: 神南1-2-3" />
            </div>
          </div>
          <div>
            <label htmlFor="fac-bldg" className="form-label">建物名・階</label>
            <SbInput id="fac-bldg" value={building} onChange={(e) => setBuilding(e.target.value)} maxLength={FACILITY_INPUT_LIMITS.building} />
          </div>
          <div>
            <label htmlFor="fac-access" className="form-label">アクセス情報</label>
            <SbInput id="fac-access" value={accessInfo} onChange={(e) => setAccessInfo(e.target.value)} placeholder="例: 渋谷駅から徒歩3分" maxLength={200} />
          </div>
          <div>
            <label htmlFor="fac-station" className="form-label">最寄り駅</label>
            <SbInput id="fac-station" value={nearestStation} onChange={(e) => setNearestStation(e.target.value)} maxLength={FACILITY_INPUT_LIMITS.nearestStation} />
          </div>
        </div>
      </section>

      {/* 連絡先 */}
      <section className="bg-white rounded-xl shadow-xs p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">連絡先</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="fac-phone" className="form-label">電話番号</label>
            <SbInput id="fac-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03-1234-5678" maxLength={20} />
          </div>
          <div>
            <label htmlFor="fac-web" className="form-label">Webサイト</label>
            {/* type="url" はスキームの無い入力をブラウザが弾くため text にする（https:// は保存時に補う）。 */}
            <SbInput id="fac-web" type="text" inputMode="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="例: www.example.com" maxLength={FACILITY_INPUT_LIMITS.website}
              aria-invalid={fieldErrors.website_url ? true : undefined} aria-describedby={fieldErrors.website_url ? 'fac-web-error' : undefined} />
            <FieldError id="fac-web-error" message={fieldErrors.website_url} />
          </div>
        </div>
      </section>

      {/* 営業時間 */}
      <section className="bg-white rounded-xl shadow-xs p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">営業時間</h2>
        {submittedHoursText && <p className="text-sm whitespace-pre-wrap mb-3">申込時の営業時間：{submittedHoursText}</p>}
        {!hoursConfirmed && (
          <p className="text-sm text-amber-800 mb-3">
            曜日別の営業時間はまだ保存されていません。営業する曜日の開店・閉店時間を入力し、休みの曜日は「営業」のチェックを外して保存してください。保存するとネット予約の空き枠とスタッフの勤務時間の下書きに使われます。
          </p>
        )}
        <FieldError id="fac-hours-error" message={fieldErrors.business_hours} />
        <div className="space-y-3">
          {dayOrder.map((day) => (
            // スマホ（幅 320〜390px）では時刻の入力を曜日の下の行へ折り返す（1行だと閉店時間がカードの外へはみ出した）。
            <div key={day} className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="w-8 text-sm font-medium text-center">{dayLabels[day]}</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!closedDays.includes(day)}
                  onChange={() => toggleClosed(day)}
                  aria-label={`${dayLabels[day]}曜日に営業する`}
                  className="rounded-sm border-gray-300 text-sky-500 focus:ring-sky-500"
                />
                <span className="text-xs text-gray-600">営業</span>
              </label>
              {!closedDays.includes(day) ? (
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <SbInput
                    type="time"
                    aria-label={`${dayLabels[day]}曜日の開店時間`}
                    value={hours[day]?.open ?? ''}
                    onChange={(e) => updateHour(day, 'open', e.target.value)}
                    className="min-w-0 flex-1 py-1.5! px-2! text-sm sm:w-32! sm:flex-none"
                  />
                  <span className="text-gray-400">〜</span>
                  <SbInput
                    type="time"
                    aria-label={`${dayLabels[day]}曜日の閉店時間`}
                    value={hours[day]?.close ?? ''}
                    onChange={(e) => updateHour(day, 'close', e.target.value)}
                    className="min-w-0 flex-1 py-1.5! px-2! text-sm sm:w-32! sm:flex-none"
                  />
                </div>
              ) : (
                <span className="text-sm text-gray-500">定休日</span>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={copyHours} className="mt-3 text-sm text-sky-700 underline">
          最初に入力した曜日の時間を、ほかの営業日にも入れる
        </button>
        <div className="mt-4">
          <label htmlFor="fac-holiday" className="form-label">定休日（補足）</label>
          <SbInput id="fac-holiday" value={regularHoliday} onChange={(e) => setRegularHoliday(e.target.value)} placeholder="例: 第2・4月曜、年末年始" maxLength={FACILITY_INPUT_LIMITS.regularHoliday} />
        </div>
      </section>

      {/* 予約設定 */}
      <section className="bg-white rounded-xl shadow-xs p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">予約設定</h2>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoConfirm}
            onChange={(e) => setAutoConfirm(e.target.checked)}
            className="mt-0.5 rounded-sm border-gray-300 text-sky-500 focus:ring-sky-500"
          />
          <div>
            <p className="text-sm font-medium text-gray-800">予約を即時確定する</p>
            <p className="text-xs text-gray-500 mt-0.5">
              ONにすると、ユーザーが予約した際に自動で「確定」状態になります。OFFの場合は「確認待ち」として管理画面で手動確定が必要です。
            </p>
          </div>
        </label>
        <div className="mt-4 border-t pt-4">
          <label htmlFor="buffer-minutes" className="block text-sm font-medium text-gray-800 mb-1">
            施術後バッファタイム（準備時間）
          </label>
          <p className="text-xs text-gray-500 mb-2">
            施術終了後に確保するスタッフの準備時間です。この時間は予約枠として表示されません。
          </p>
          <div className="flex items-center gap-3">
            <select
              id="buffer-minutes"
              value={bufferMinutes}
              onChange={(e) => setBufferMinutes(parseInt(e.target.value, 10))}
              className="form-input w-40"
            >
              {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>{m === 0 ? 'なし' : `${m}分`}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 border-t pt-4">
          <label htmlFor="board-slot-minutes" className="block text-sm font-medium text-gray-800 mb-1">
            サロンボードの時間刻み
          </label>
          <p className="text-xs text-gray-500 mb-2">
            予約管理のサロンボード（スタッフ×時間軸）の区切り幅です。空き帯クリック時の時刻スナップもこの単位になります。
          </p>
          <div className="flex items-center gap-3">
            <select
              id="board-slot-minutes"
              value={boardSlotMinutes}
              onChange={(e) => setBoardSlotMinutes(parseInt(e.target.value, 10))}
              className="form-input w-40"
            >
              {[15, 30, 60].map((m) => (
                <option key={m} value={m}>{`${m}分`}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* 設備・特徴 */}
      <section className="bg-white rounded-xl shadow-xs p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">設備・特徴</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="fac-seats" className="form-label">席数</label>
            <SbInput id="fac-seats" type="number" min={0} value={seatCount} onChange={(e) => setSeatCount(e.target.value)} />
          </div>
          <div>
            <label htmlFor="fac-staff-count" className="form-label">スタッフ数</label>
            <SbInput id="fac-staff-count" type="number" min={0} value={staffCount} onChange={(e) => setStaffCount(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-6 mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={parking} onChange={(e) => setParking(e.target.checked)} className="rounded-sm border-gray-300 text-sky-500 focus:ring-sky-500" />
            <span className="text-sm">駐車場あり</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={creditCard} onChange={(e) => setCreditCard(e.target.checked)} className="rounded-sm border-gray-300 text-sky-500 focus:ring-sky-500" />
            <span className="text-sm">クレジットカード可</span>
          </label>
        </div>
        <p className="form-label">その他の特徴</p>
        <div className="flex flex-wrap gap-2">
          {facilityFeatures.filter((f) => f !== '駐車場あり' && f !== 'クレジットカード可').map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => toggleFeature(f)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                selectedFeatures.includes(f)
                  ? 'bg-sky-500 text-white border-sky-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-sky-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </section>

      {/* データエクスポート */}
      <section className="bg-white rounded-xl shadow-xs p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">データエクスポート</h2>
        <p className="text-sm text-gray-500 mb-4">
          予約データをCSV形式でダウンロードできます（予約日の新しい順に最大{BOOKING_CSV_MAX_ROWS.toLocaleString()}件）。
        </p>
        <button
          type="button"
          disabled={csvExporting}
          onClick={async () => {
            if (!facilityId) return;
            setCsvExporting(true);
            setCsvTruncated(false);
            try {
              // 1000 件ずつページングして読む（以前は 1 回読みで、PostgREST の max_rows により
              // 1000 件で黙って打ち切られていた）。src/lib/booking-csv-export.ts
              const { rows, truncated, error } = await readBookingCsvRows(createBrowserSupabaseClient(), facilityId);
              if (error) {
                setToast({ type: 'error', message: '予約データの取得に失敗しました。再度お試しください' });
                return;
              }
              if (rows.length === 0) {
                setToast({ type: 'error', message: 'エクスポートする予約データがありません' });
                return;
              }
              const blob = new Blob([buildBookingCsv(rows)], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `carelink-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 200);
              setCsvTruncated(truncated);
              setToast({
                type: 'success',
                message: truncated
                  ? `CSVをダウンロードしました（新しい順に${BOOKING_CSV_MAX_ROWS.toLocaleString()}件まで）`
                  : `CSVをダウンロードしました（${rows.length.toLocaleString()}件）`,
              });
            } finally {
              setCsvExporting(false);
            }
          }}
          className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
        >
          {csvExporting ? 'CSVを作成中...' : '予約データCSVダウンロード'}
        </button>
        {csvTruncated && (
          <p role="status" className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            予約が{BOOKING_CSV_MAX_ROWS.toLocaleString()}件を超えているため、予約日の新しい順に{BOOKING_CSV_MAX_ROWS.toLocaleString()}件までを出力しました。それより古い予約はCSVに含まれていません。
          </p>
        )}
      </section>

      {/* 保存ボタン(下部) */}
      <div className="flex justify-end">
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary px-8 py-3!">
          {saving ? '保存中...' : '施設情報を保存'}
        </button>
      </div>

      {/* キャンセルポリシー（v8.5） */}
      {facilityId && <CancelPolicySettings facilityId={facilityId} />}

      {/* 通知設定（v8.1） */}
      {facilityId && <NotificationSettings facilityId={facilityId} />}

      {/* リマインダー設定＋有料オプション（アップセル） */}
      {facilityId && <ReminderUpsellSettings facilityId={facilityId} />}

      {/* GBP連携（Googleビジネスプロフィール） */}
      <section className="bg-white rounded-xl shadow-xs p-6 mt-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">GBP連携（Googleビジネスプロフィール）</h2>
          <Link href={`/admin/gbp?facility_id=${facilityId}`} className="text-sm text-sky-500 underline">GBP管理画面へ →</Link>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Google Place ID を登録すると、Googleマップの診断スコア・クチコミ・投稿管理が使えます。
        </p>
        {/* 照合に使う項目を変えると DB のトリガが Place ID を外す（20261023150200）。保存してから驚かせない。 */}
        <p className="text-sm text-gray-600 mb-4">{GBP_IDENTITY_CHANGE_NOTICE}</p>
        <div className="bg-sky-50 rounded-lg p-3 text-xs text-sky-700 mb-4">
          Place ID は{' '}
          <a href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder"
             target="_blank" rel="noopener noreferrer" className="underline">Place ID Finder</a>
          {' '}で自店舗を検索して取得できます（「ChIJ...」から始まる文字列）
        </div>
        <Link href={`/admin/gbp?facility_id=${facilityId}`} className="btn-primary text-sm px-5! py-2!">
          GBP設定・診断を開く
        </Link>
      </section>

      {/* LINE Works 連携の設定案内は出さない。以前は Client Secret・Private Key をメールで運営へ送るよう
          案内していた（秘密情報を平文のメールで受け渡す手順）。安全な受け渡し方法ができるまで非公開
          （スタッフに登録済みのチャンネルID などのデータは残している）。 */}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={showUnpublishConfirm}
        title="施設を非公開にする"
        message="施設を非公開にしますか？検索結果から消え、新規予約ができなくなります。"
        confirmLabel="非公開にする"
        cancelLabel="キャンセル"
        onConfirm={async () => {
          setShowUnpublishConfirm(false);
          setPublishToggling(true);
          // 通信エラーで fetch が throw してもボタンが「処理中...」のまま固着しないよう
          // try/finally で必ずトグル状態を解除し、失敗はトーストで明示する。
          try {
            const res = await fetch(`/api/admin/settings?facility_id=${facilityId}&action=status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'draft' }),
            });
            const body = await res.json().catch(() => null);
            if (res.ok && body?.ok === true) {
              setFacilityStatus('draft');
              setToast({ type: 'success', message: '施設を非公開にしました' });
            } else {
              setToast({ type: 'error', message: '非公開への変更に失敗しました' });
            }
          } catch {
            setToast({ type: 'error', message: '通信エラーが発生しました' });
          } finally {
            setPublishToggling(false);
          }
        }}
        onCancel={() => setShowUnpublishConfirm(false)}
      />

      <WithdrawalSettings />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="mt-1 text-sm text-red-700">{message}</p>;
}

/**
 * ネット予約の準備状況。ダッシュボードの「ネット予約の準備内容を確認する」はここへ来るが、
 * 以前は何が足りないのかの一覧が無かった。判定は予約ページ・検索カードと同じ単一ソース（保存済みの内容）。
 */
function BookingReadinessSection({ readiness, facilityId, onRetry }: {
  readiness: { state: 'loading' | 'error' } | { state: 'ready'; steps: FacilitySetupStep[] };
  facilityId: string; onRetry: () => void;
}) {
  const steps = readiness.state === 'ready'
    ? readiness.steps.filter((step) => step.group === 'booking' || step.key === 'publish')
    : [];
  const pending = steps.filter((step) => !step.done);
  return (
    <section id="booking-readiness" aria-labelledby="booking-readiness-title" className="bg-white rounded-xl shadow-xs p-6 mb-6">
      <h2 id="booking-readiness-title" className="text-lg font-bold mb-1">ネット予約の準備状況</h2>
      {readiness.state === 'loading' && <p className="text-sm text-gray-600">準備状況を確認しています…</p>}
      {readiness.state === 'error' && (
        <p className="text-sm text-gray-700">
          準備状況を読み込めませんでした。
          <button type="button" onClick={onRetry} className="ml-1 text-sky-700 underline">もう一度読み込む</button>
        </p>
      )}
      {readiness.state === 'ready' && (
        <>
          <p className="text-sm text-gray-600 mb-3">
            {pending.length === 0
              ? 'ネット予約を受け付けられる状態です。'
              : `保存済みの内容では、あと${pending.length}項目でネット予約を始められます（掲載だけの利用なら不要です）。`}
          </p>
          <ul className="space-y-2">
            {steps.map((step) => (
              <li key={step.key} className="flex flex-wrap items-center gap-x-2 text-sm">
                <span aria-hidden="true" className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${step.done ? 'bg-green-700 text-white' : 'border-2 border-gray-300'}`}>{step.done ? '✓' : ''}</span>
                <span className="sr-only">{step.done ? '済み：' : '未完了：'}</span>
                {step.done ? (
                  <span className="text-gray-700">{step.label}</span>
                ) : (
                  <Link href={`${step.href}?facility_id=${encodeURIComponent(facilityId)}`} className="font-medium text-sky-700 underline">{step.label}</Link>
                )}
                {step.note && <span className="text-xs text-gray-600">（{step.note}）</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SettingsSelectionRoute() {
  const requested = useSearchParams().get('facility_id');
  return <AdminSettingsContent key={requested ?? 'unselected'} />;
}

export default function AdminSettingsPage() {
  return <Suspense fallback={<AdminPageLoading />}><SettingsSelectionRoute /></Suspense>;
}
