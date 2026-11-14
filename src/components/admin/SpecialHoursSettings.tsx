'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import SpecialHoursEditor, { type SpecialHoursDraft } from './SpecialHoursEditor';

type Loaded = SpecialHoursDraft & { revision: string | null };
const loadedSchema = z.object({
  allowOvernightBookings: z.boolean(), closeOnPublicHolidays: z.boolean(),
  closedDates: z.array(z.iso.date()).max(366),
  receptionCutoffMinutes: z.number().int().min(0).max(1440).nullable(),
  revision: z.iso.datetime({ offset: true }).nullable(),
}).strict();
type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; loaded: Loaded; draft: SpecialHoursDraft };

/** The parent supplies the selected facility and remounts when it changes. */
export default function SpecialHoursSettings({ facilityId, onDirtyChange, onBusyChange }: {
  facilityId: string; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const dirty = state.kind === 'ready' && JSON.stringify(state.loaded) !== JSON.stringify({ ...state.draft, revision: state.loaded.revision });
  useUnsavedGuard(dirty);
  const endpoint = `/api/admin/special-hours?facility_id=${encodeURIComponent(facilityId)}`;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('unavailable');
      const data: Loaded = loadedSchema.parse(await response.json());
      if (active) setState({ kind: 'ready', loaded: data, draft: {
        allowOvernightBookings: data.allowOvernightBookings,
        closeOnPublicHolidays: data.closeOnPublicHolidays, closedDates: data.closedDates,
        receptionCutoffMinutes: data.receptionCutoffMinutes,
      } });
    }).catch(() => { if (active) setState({ kind: 'error', message: '設定を読み込めませんでした。' }); });
    return () => { active = false; controller.abort(); };
  }, [endpoint, reload]);

  const save = async () => {
    if (state.kind !== 'ready' || saving) return;
    setSaving(true); onBusyChange?.(true); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...state.draft, revision: state.loaded.revision }) });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setMessage(data.error || '保存できませんでした。入力は残っています。');
        return;
      }
      // A successful write does not provide a revision. Read it before allowing
      // another save, so the next request cannot overwrite a newer edit.
      const confirm = await fetch(endpoint, { cache: 'no-store' });
      if (!confirm.ok) { setMessage('保存後の確認ができません。再読み込みして確認してください。'); return; }
      const latest: Loaded = loadedSchema.parse(await confirm.json());
      if (latest.allowOvernightBookings !== state.draft.allowOvernightBookings ||
          latest.closeOnPublicHolidays !== state.draft.closeOnPublicHolidays ||
          latest.receptionCutoffMinutes !== state.draft.receptionCutoffMinutes ||
          JSON.stringify([...latest.closedDates].sort()) !== JSON.stringify([...state.draft.closedDates].sort())) {
        setMessage('保存後に別の画面から設定が変更されました。再読み込みして確認してください。'); return;
      }
      setState({ kind: 'ready', loaded: latest, draft: state.draft });
      onDirtyChange?.(false);
      setMessage('保存しました。');
    } catch { setMessage('保存結果を確認できません。再読み込みして確認してください。'); }
    finally { setSaving(false); onBusyChange?.(false); }
  };

  if (state.kind === 'loading') return <p>特別な営業時間を読み込み中です。</p>;
  if (state.kind === 'error') return <div role="alert">{state.message} <button type="button" onClick={() => { setState({ kind: 'loading' }); setReload(value => value + 1); }}>再読み込み</button></div>;
  return <section aria-label="祝日・臨時休業と受付終了" onChange={event => event.stopPropagation()} className="mt-6 border-t border-gray-200 pt-5">
    <h3 className="mb-3 font-bold">祝日・臨時休業と受付終了</h3>
    <fieldset disabled={saving}>
      <SpecialHoursEditor value={state.draft} onChange={draft => {
        setState({ ...state, draft });
        onDirtyChange?.(JSON.stringify(state.loaded) !== JSON.stringify({ ...draft, revision: state.loaded.revision }));
        setMessage('');
      }} />
    </fieldset>
    <button type="button" disabled={saving || !dirty} onClick={() => void save()} className="mt-4 rounded bg-sky-700 px-4 py-3 text-sm text-white disabled:opacity-50">
      {saving ? '保存中' : '祝日・臨時休業と受付終了を保存'}
    </button>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </section>;
}
