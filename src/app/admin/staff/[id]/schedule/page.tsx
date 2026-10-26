'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { staffOperationKey, beginStaffOperation, finishStaffOperation, recoverStaffOperation } from '@/lib/staff-operation';
import Toast from '@/components/Toast';
import FacilitySelector from '@/components/admin/FacilitySelector';
import { loadAdminFacilitySelection, type AdminFacilityChoice } from '@/lib/admin-facility-selection';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { SbInput, SbPageHeader } from '@/components/admin/SbUi';
import SessionExpiredNotice from '@/components/admin/SessionExpiredNotice';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import Link from 'next/link';
import { suggestStaffWeekFromBusinessHours } from '@/lib/staff-schedule-suggestion';
import { todayJst } from '@/lib/admin-date';

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface Schedule {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

interface Override {
  id: string;
  date: string;
  is_holiday: boolean;
  start_time: string | null;
  end_time: string | null;
}

export default function StaffSchedulePage() {
  const requestedFacility = useSearchParams().get('facility_id');
  const staffId = useParams().id;
  return <StaffSchedulePageForm key={`${staffId}:${requestedFacility ?? ''}`} />;
}

function StaffSchedulePageForm() {
  const params = useParams();
  const router = useRouter();
  const requestedFacility = useSearchParams().get('facility_id');
  const [facilityChoices, setFacilityChoices] = useState<AdminFacilityChoice[]>([]);
  const [authState, setAuthState] = useState<'verified' | 'unauthenticated' | 'unavailable'>('verified');
  const staffId = params.id as string;
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const backFacility = facilityId ?? requestedFacility;
  const backHref = `/admin/staff${backFacility ? `?facility_id=${encodeURIComponent(backFacility)}` : ''}`;
  const [staffName, setStaffName] = useState('');
  const [schedules, setSchedules] = useState<Schedule[]>(
    DAY_LABELS.map((_, i) => ({ day_of_week: i, start_time: '09:00', end_time: '19:00' }))
  );
  const [enabledDays, setEnabledDays] = useState<boolean[]>(Array(7).fill(true));
  // 勤務時間が1つも無い（週間の勤務日も、今日以降に勤務する特別日も無い）とき、表示中の内容が何か
  // （店舗の営業時間からの下書き／空）。null＝保存済みの勤務を表示している。
  const [draft, setDraft] = useState<'suggested' | 'empty' | null>(null);
  // 週間の勤務日は無いが、勤務する特別日がある（その日だけ予約を受けられる）。
  const [overridesOnly, setOverridesOnly] = useState(false);
  const justAdded = useSearchParams().get('added') === '1';
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [newOverrideDate, setNewOverrideDate] = useState('');
  const [newOverrideHoliday, setNewOverrideHoliday] = useState(true);
  const [newOverrideStart, setNewOverrideStart] = useState('09:00');
  const [newOverrideEnd, setNewOverrideEnd] = useState('19:00');
  const operationKey = useRef<string | null>(null);
  const pendingSchedules = useRef<{ operation_id: string; schedules: Schedule[]; force?: boolean } | null>(null);
  const [pendingSave, setPendingSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingOverride, setAddingOverride] = useState(false);
  const [deletingOverride, setDeletingOverride] = useState(false);
  const [confirmDeleteOverrideId, setConfirmDeleteOverrideId] = useState<string | null>(null);
  // 既存予約への影響（API が 409+件数を返した時）を確認ダイアログで提示し、承認時のみ force で強行する。
  const [scheduleAffected, setScheduleAffected] = useState<number | null>(null);
  const [overrideAffected, setOverrideAffected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // React Compiler の set-state-in-effect 対策：取得処理を useCallback 関数として effect の
  // 依存に置き外部から直接呼ぶのではなく、effect 内に inline した非同期IIFEとして定義する
  // （React 公式が推奨する形）。再取得（リトライ・特別日追加後の再読込）は関数呼び出しではなく
  // reloadKey をインクリメントして effect を再発火させる形に統一し、取得ロジックの二重定義を避ける。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      setLoading(true);
      setFacilityId(null);
      const verification = await verifyAuthUser(supabase.auth);
      if (!active) return;
      setAuthState(verification.state);
      if (verification.state !== 'verified') { setLoading(false); return; }
      const selection = await loadAdminFacilitySelection(supabase, verification.user.id, requestedFacility);
      if (!active) return;
      setFacilityChoices(selection.choices);
      if (!selection.selectedId) { setLoading(false); return; }
      const selectedFacilityId = selection.selectedId;
      if (selectedFacilityId) {
        const key = staffOperationKey(verification.user.id, selectedFacilityId, staffId);
        await recoverStaffOperation(key, selectedFacilityId, staffId);
        if (!active) return;
        operationKey.current = key;
      }
      const { data: staff, error: staffError } = await supabase.from('staff_profiles').select('name').eq('id', staffId).eq('facility_id', selectedFacilityId).single();
      if (!active) return;
      if (staffError || !staff) { setLoadError(true); setLoading(false); return; }
      setStaffName(staff.name);
      // 週間スケジュールはフォーム初期値。取得失敗を握り潰すと既定値(09:00-19:00全曜日)で
      // 実シフトを上書きする事故になるため、失敗時はフォームを描画しない。
      const { data: schData, error: schErr } = await supabase
        .from('staff_schedules')
        .select('day_of_week, start_time, end_time')
        .eq('staff_id', staffId)
        .order('day_of_week');

      if (!active) return;
      if (schErr || !Array.isArray(schData)) { setLoadError(true); setLoading(false); return; }

      const { data: ovData, error: ovErr } = await supabase
        .from('schedule_overrides')
        .select('id, date, is_holiday, start_time, end_time')
        .eq('staff_id', staffId)
        // 今日は日本時間で切る（UTC だと 0〜9 時に前日の特別日まで読んでいた）。
        .gte('date', todayJst())
        .order('date');
      if (!active) return;
      if (ovErr) { setLoadError(true); setLoading(false); return; }

      if (schData.length === 0) {
        // 週間の勤務日が1日も無い。追加しただけのスタッフはこの状態から始まる（DB は既定の勤務を作らない）。
        // 時間を入れる曜日の初期値には、店舗の確定済み営業時間を使う（09:00〜19:00 を持ち込まない）。
        const { data: facilityRow, error: facilityErr } = await supabase
          .from('facility_profiles').select('business_hours').eq('id', selectedFacilityId).single();
        if (!active) return;
        if (facilityErr) { setLoadError(true); setLoading(false); return; }
        const suggestion = suggestStaffWeekFromBusinessHours(facilityRow?.business_hours);
        if (suggestion) setSchedules(suggestion.map(({ day_of_week, start_time, end_time }) => ({ day_of_week, start_time, end_time })));
        // 特別日だけ勤務するスタッフは、その日に予約を受けられる（予約枠・公開カードと同じ規則）。
        // 未登録とは言わず、保存済みのとおり週間は全曜日休みで見せ、下書きのチェックも入れない。
        const today = todayJst();
        const worksOnSpecialDay = (ovData ?? []).some((o) => o.date >= today && o.is_holiday !== true && o.start_time && o.end_time);
        setOverridesOnly(worksOnSpecialDay);
        if (worksOnSpecialDay) {
          setDraft(null);
          setEnabledDays(Array(7).fill(false));
        } else {
          // 勤務時間が無い＝このスタッフには予約枠が出ない。店舗の営業時間を下書きとして見せ、保存したときだけ登録する。
          setDraft(suggestion ? 'suggested' : 'empty');
          setEnabledDays(suggestion ? suggestion.map((day) => day.enabled) : Array(7).fill(false));
          // 下書きは未保存。そのまま離れると勤務時間は登録されないので、離れる前に確認する。
          setDirty(Boolean(suggestion));
        }
      } else {
        const newSchedules = DAY_LABELS.map((_, i) => {
          const existing = schData.find((s) => s.day_of_week === i);
          // staff_schedules.start_time/end_time は TIME 列で "HH:MM:SS" で返る。API/入力は "HH:MM"
          // 必須のため、ロード時に正規化する。これを怠ると、既存スタッフのスケジュールを再保存
          // （各曜日を手で選び直さずに保存）した際に "HH:MM:SS" が再送され一律 400 になる。
          return existing
            ? { day_of_week: i, start_time: existing.start_time.slice(0, 5), end_time: existing.end_time.slice(0, 5) }
            : { day_of_week: i, start_time: '09:00', end_time: '19:00' };
        });
        setDraft(null);
        setOverridesOnly(false);
        setSchedules(newSchedules);
        setEnabledDays(DAY_LABELS.map((_, i) => schData.some((s) => s.day_of_week === i)));
      }
      // schedule_overrides の start_time/end_time も TIME 列で "HH:MM:SS" で返る。表示と再保存の
      // 一貫性のため "HH:MM" に正規化する（null=休日はそのまま）。
      // is_holiday は `BOOLEAN DEFAULT false` のみで NOT NULL 制約が無く DB 上 null もあり得る
      // （supabase/migrations/20260323000003_phase4_bookings.sql）。null は「休日フラグ未設定」を
      // 意味し、既定値である false（休日ではない）に倒すのが DEFAULT の意図と一致する。
      if (ovData) setOverrides(ovData.map((o) => ({
        ...o,
        is_holiday: o.is_holiday ?? false,
        start_time: o.start_time ? o.start_time.slice(0, 5) : o.start_time,
        end_time: o.end_time ? o.end_time.slice(0, 5) : o.end_time,
      })));
      if (!active) return;
      setFacilityId(selectedFacilityId);
      setLoading(false);
    })().catch(() => { if (active) { setLoadError(true); setLoading(false); } });
    return () => { active = false; };
  }, [staffId, reloadKey, requestedFacility]);

  const handleSaveSchedules = async (force = false) => {
    if (!facilityId || !operationKey.current || saving) return;
    const rows = schedules
      .filter((_, i) => enabledDays[i])
      .map((s) => ({ day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time }));
    // 勤務日が0日のまま保存すると、このスタッフには予約が1件も入らない（保存は成功に見える）。
    // 特別日にだけ勤務する人は、その日があれば予約を受けられるので止めない。
    const worksOnSpecialDay = overrides.some((o) => !o.is_holiday && o.start_time && o.end_time);
    if (rows.length === 0 && !worksOnSpecialDay) {
      setToast({ type: 'error', message: '勤務する曜日を1日以上選んでください。勤務日が無いと、このスタッフにはネット予約が入りません（特別な日だけ勤務する場合は、下の「特別日設定」で勤務日を追加してください）' });
      return;
    }
    setSaving(true);
    try {

      if (pendingSchedules.current === null) {
        pendingSchedules.current = { operation_id: beginStaffOperation(operationKey.current), schedules: rows, ...(force ? { force: true } : {}) };
        setPendingSave(true);
      }
      const res = await fetch(`/api/admin/staff/${staffId}/schedule?facility_id=${facilityId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingSchedules.current),
      });
      // 既存予約に影響がある場合は 409+件数。無警告で上書きせず確認ダイアログを出す。
      if (res.status === 409) {
        const e = await res.json().catch(() => ({}));
        if (e.code === 'BOOKINGS_AFFECTED') { finishStaffOperation(operationKey.current); pendingSchedules.current = null; setPendingSave(false); setScheduleAffected(e.affectedBookings ?? 0); return; }
        setToast({ type: 'error', message: e.error || '保存に失敗しました' });
        return;
      }
      if (!res.ok) {
        if (res.status < 500) {
          const recovered = await recoverStaffOperation(operationKey.current, facilityId, staffId);
          pendingSchedules.current = null; setPendingSave(false);
          if (recovered === 'saved') { setReloadKey(k => k + 1); setDirty(false); return; }
        }
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '保存に失敗しました' });
        return;
      }
      finishStaffOperation(operationKey.current); pendingSchedules.current = null; setPendingSave(false);
      setDirty(false);
      setReloadKey(k => k + 1);
      // 勤務時間が店舗の営業時間と重ならない曜日があれば、API が warning で知らせる（保存はされている）。
      const saved = await res.json().catch(() => ({}));
      setToast(typeof saved?.warning === 'string' && saved.warning
        ? { type: 'info', message: `スケジュールを保存しました。${saved.warning}` }
        : { type: 'success', message: 'スケジュールを保存しました' });
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddOverride = async (force = false) => {
    if (!newOverrideDate || !facilityId || addingOverride) return;
    setAddingOverride(true);
    try {
      const body: Record<string, unknown> = {
        date: newOverrideDate,
        is_holiday: newOverrideHoliday,
      };
      if (!newOverrideHoliday) {
        body.start_time = newOverrideStart;
        body.end_time = newOverrideEnd;
      }
      if (force) body.force = true;
      const res = await fetch(`/api/admin/staff/${staffId}/schedule?facility_id=${facilityId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // 既存予約に影響がある場合は 409+件数。無警告で確定せず確認ダイアログを出す。
      if (res.status === 409) {
        const e = await res.json().catch(() => ({}));
        if (e.code === 'BOOKINGS_AFFECTED') { setOverrideAffected(e.affectedBookings ?? 0); return; }
        setToast({ type: 'error', message: e.error || '追加に失敗しました' });
        return;
      }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '追加に失敗しました' });
        return;
      }
      setNewOverrideDate('');
      setReloadKey((k) => k + 1);
      const added = await res.json().catch(() => ({}));
      setToast(typeof added?.warning === 'string' && added.warning
        ? { type: 'info', message: `特別日を追加しました。${added.warning}` }
        : { type: 'success', message: '特別日を追加しました' });
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setAddingOverride(false);
    }
  };

  const handleDeleteOverride = async (id: string) => {
    if (!facilityId || deletingOverride) return;
    setDeletingOverride(true);
    try {
      const res = await fetch(`/api/admin/staff/${staffId}/schedule?facility_id=${facilityId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override_id: id }),
      });
      if (res.ok) {
        setOverrides((prev) => prev.filter((o) => o.id !== id));
      } else {
        setToast({ type: 'error', message: '削除に失敗しました' });
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました。削除結果を再読み込みして確認してください' });
    } finally {
      setDeletingOverride(false);
    }
  };

  if (loading) return <AdminPageLoading />;
  if (authState === 'unavailable') return <AccessVerificationUnavailable />;
  if (authState === 'unauthenticated') return <SessionExpiredNotice redirectTo={`/admin/staff/${encodeURIComponent(staffId)}/schedule${requestedFacility ? `?facility_id=${encodeURIComponent(requestedFacility)}` : ''}`} />;
  const selector = <FacilitySelector choices={facilityChoices} selectedId={facilityId} path="/admin/staff" dirty={dirty} busy={saving || addingOverride || deletingOverride || pendingSave} />;

  // 見出しは管理画面共通の SbPageHeader（以前はこの画面だけ独自の大きな h1 だった）。
  const backButton = <button type="button" onClick={() => router.push(backHref)} className="text-sm text-gray-600 hover:underline">← 戻る</button>;

  // 取得失敗時はフォームを描画しない（既定シフトで実スケジュールを上書きする事故を防ぐ）
  if (loadError) {
    return (
      <div>
        <SbPageHeader title="スケジュール" actions={backButton} />
        <LoadError onRetry={() => setReloadKey((k) => k + 1)} message="スケジュールの読み込みに失敗しました" />
      </div>
    );
  }

  if (!facilityId) return selector;

  return (
    <div onChange={() => setDirty(true)}>
      {selector}
      <SbPageHeader title={`${staffName}のスケジュール`} actions={backButton} />

      {draft && (
        <div role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
          {justAdded && <p>スタッフを追加しました。</p>}
          <p className="font-bold">このスタッフは勤務時間が未登録のため、まだネット予約を受けられません。</p>
          <p>予約表の「指名なし」の予約も、勤務時間を保存したスタッフにだけ割り当てられます。</p>
          {draft === 'suggested' ? (
            <p>下の時間は店舗の営業時間をもとにした下書きで、まだ保存されていません。実際の勤務日・時間に合わせて直してから「この勤務時間で保存する」を押してください。</p>
          ) : (
            <p>
              店舗の営業時間がまだ保存されていないため、下書きを用意できませんでした。勤務する曜日にチェックを入れ、時間を入力して保存してください。
              <Link href={`/admin/settings?facility_id=${encodeURIComponent(facilityId)}`} className="ml-1 font-bold text-amber-900 underline">施設設定で営業時間を保存する</Link>
            </p>
          )}
        </div>
      )}

      {overridesOnly && !draft && (
        <p role="status" className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          週間の勤務日は登録されていません。下の「特別日設定」で勤務時間を入れた日だけ、ネット予約を受けられます。
        </p>
      )}

      {/* Weekly Schedule */}
      <div className="bg-white rounded-xl shadow-xs p-4 sm:p-6 mb-6">
        <h2 className="font-bold mb-4">週間スケジュール</h2>
        <fieldset disabled={saving || pendingSave} className="space-y-3">
          {DAY_LABELS.map((label, i) => (
            // スマホ（幅 320〜390px）では時刻の入力を曜日の下の行へ折り返す。1 行に並べると終了時刻が
            // カードの外へはみ出し、ページが横にスクロールしていた（スタッフ追加後に必ず通る画面）。
            <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex items-center gap-2 w-16">
                <input
                  type="checkbox"
                  checked={enabledDays[i]}
                  onChange={(e) => {
                    const next = [...enabledDays];
                    next[i] = e.target.checked;
                    setEnabledDays(next);
                  }}
                />
                <span className="text-sm font-medium">{label}</span>
              </label>
              {enabledDays[i] ? (
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <SbInput
                    type="time"
                    value={schedules[i].start_time}
                    onChange={(e) => {
                      const next = [...schedules];
                      next[i] = { ...next[i], start_time: e.target.value };
                      setSchedules(next);
                    }}
                    className="min-w-0 flex-1 text-sm sm:w-32! sm:flex-none"
                  />
                  <span className="text-gray-500">〜</span>
                  <SbInput
                    type="text" placeholder="24:00" maxLength={5}
                    value={schedules[i].end_time}
                    onChange={(e) => {
                      const next = [...schedules];
                      next[i] = { ...next[i], end_time: e.target.value };
                      setSchedules(next);
                    }}
                    className="min-w-0 flex-1 text-sm sm:w-32! sm:flex-none"
                  />
                </div>
              ) : (
                <span className="text-sm text-gray-500">休み</span>
              )}
            </div>
          ))}
        </fieldset>
        {pendingSave && <p role="status">前回の保存結果を確認するため、同じ内容で再試行してください。</p>}
        <button type="button" onClick={() => handleSaveSchedules()} disabled={saving} className="btn-primary mt-4 py-2!">
          {saving ? '保存中...' : draft ? 'この勤務時間で保存する' : 'スケジュールを保存'}
        </button>
      </div>

      {/* Schedule Overrides */}
      <div className="bg-white rounded-xl shadow-xs p-6">
        <h2 className="font-bold mb-4">特別日設定</h2>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">日付</label>
            <SbInput
              type="date"
              value={newOverrideDate}
              onChange={(e) => setNewOverrideDate(e.target.value)}
              min={todayJst()}
              className="text-sm w-40!"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">種別</label>
            <select
              value={newOverrideHoliday ? 'holiday' : 'custom'}
              onChange={(e) => setNewOverrideHoliday(e.target.value === 'holiday')}
              className="form-input text-sm w-28!"
            >
              <option value="holiday">休み</option>
              <option value="custom">時間変更</option>
            </select>
          </div>
          {!newOverrideHoliday && (
            <>
              <div>
                <label className="text-xs text-gray-500 block mb-1">開始</label>
                <SbInput type="time" value={newOverrideStart} onChange={(e) => setNewOverrideStart(e.target.value)} className="text-sm w-28!" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">終了</label>
                <SbInput type="text" placeholder="24:00" maxLength={5} value={newOverrideEnd} onChange={(e) => setNewOverrideEnd(e.target.value)} className="text-sm w-28!" />
              </div>
            </>
          )}
          <button type="button" onClick={() => handleAddOverride()} className="btn-primary text-sm py-2! px-4!">追加</button>
        </div>

        {overrides.length === 0 ? (
          <p className="text-sm text-gray-500">特別日の設定はありません</p>
        ) : (
          <div className="space-y-2">
            {overrides.map((ov) => (
              <div key={ov.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <div className="text-sm">
                  <span className="font-medium">{new Date(ov.date + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
                  {ov.is_holiday ? (
                    <span className="ml-2 text-red-500">休み</span>
                  ) : (
                    <span className="ml-2 text-gray-600">{ov.start_time}〜{ov.end_time}</span>
                  )}
                </div>
                <button type="button" disabled={deletingOverride} onClick={() => setConfirmDeleteOverrideId(ov.id)} className="text-xs text-red-400 hover:text-red-600">削除</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={confirmDeleteOverrideId !== null}
        title="特別日設定を削除"
        message="この特別日設定を削除しますか？"
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        onConfirm={() => {
          const id = confirmDeleteOverrideId;
          setConfirmDeleteOverrideId(null);
          if (id) handleDeleteOverride(id);
        }}
        onCancel={() => setConfirmDeleteOverrideId(null)}
      />
      <ConfirmDialog
        open={scheduleAffected !== null}
        title="既存予約への影響"
        message={`この変更で担当者が不在になる予約が${scheduleAffected ?? 0}件あります。それでもスケジュールを変更しますか？（変更後は該当予約の担当者を手動で調整してください）`}
        confirmLabel="変更する"
        cancelLabel="キャンセル"
        onConfirm={() => { setScheduleAffected(null); handleSaveSchedules(true); }}
        onCancel={() => setScheduleAffected(null)}
      />
      <ConfirmDialog
        open={overrideAffected !== null}
        title="既存予約への影響"
        message={`この特別日設定で担当者が不在になる予約が${overrideAffected ?? 0}件あります。それでも設定しますか？（設定後は該当予約の担当者を手動で調整してください）`}
        confirmLabel="設定する"
        cancelLabel="キャンセル"
        onConfirm={() => { setOverrideAffected(null); handleAddOverride(true); }}
        onCancel={() => setOverrideAffected(null)}
      />
    </div>
  );
}
