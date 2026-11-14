'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { UseFormWatch } from 'react-hook-form';
import type { SalonFormValues } from '@/lib/validations';
import { exportSalonDraftBackup } from '@/lib/salon-draft-backup';
import { CLIENT_CLEANUP_COMPLETED_EVENT } from '@/lib/client-cleanup-marker';
import { clearLocalSalonDraft, lockLocalSalonDraft, readLocalSalonDraft, restoreLocalSalonDraft,
  replaceLockedLocalSalonDraft, saveLocalSalonDraft, SalonLocalDraftError, type LocalSalonDraft } from '@/lib/salon-local-draft';

export interface SalonLocalDraftHandle {
  beforeSubmit(values: SalonFormValues, photos: readonly (File | null)[]): Promise<boolean>;
  confirmed(): Promise<void>;
  /** Transport must prove /commit has never been attempted for this context. */
  rejectedBeforeCommit(): Promise<void>;
  /** Manual import may adopt only the exact verified saved input. */
  adoptManualBackup(blob: Blob): Promise<boolean>;
}
interface Props {
  getValues: () => SalonFormValues;
  watch: UseFormWatch<SalonFormValues>;
  photos: readonly (File | null)[];
  canSave: () => boolean;
  canRestore: () => boolean;
  onRestore: (blob: Blob) => Promise<void>;
  /**
   * 利用者に見てもらう必要がある状態（この端末に下書きがある・保存に失敗した）になったとき。
   * 呼び出し側は畳んである操作欄を開く。閉じたままだと復元できることにも失敗にも気づけない。
   */
  onAttention?: () => void;
}
const failureMessage = (error: unknown) => error instanceof SalonLocalDraftError && error.code === 'conflict'
  ? '別のタブで下書きが変わったため、自動保存を止めました。ページを再読み込みしてください。'
  : error instanceof SalonLocalDraftError && error.code === 'locked'
    ? '送信に使った下書きは復元できません。先に受付状況を確認してください。'
    : '下書きを保存できませんでした。入力はそのままです。「ファイルに保存」をお使いください。';

/** 下書き・バックアップ操作のボタン。押せる大きさ（44px）を確保し、文字リンク風にしない。 */
export const DRAFT_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-(--ecru-muted) bg-(--ecru-surface) px-4 text-sm text-(--ecru-text) disabled:cursor-not-allowed disabled:opacity-50';
/** 取り消せない操作（端末の下書きを削除）。赤字＋赤枠で他の操作と区別する。 */
export const DRAFT_DANGER_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-red-700 bg-(--ecru-surface) px-4 text-sm text-red-700 disabled:cursor-not-allowed disabled:opacity-50';

/** Opt-in is deliberately memory-only. The persisted input has neither consent
 * nor submission authority; the fence survives lost browser/session context. */
export const SalonLocalDraftControls = forwardRef<SalonLocalDraftHandle, Props>(function SalonLocalDraftControls(props, ref) {
  const latest = useRef(props);
  const mounted = useRef(false);
  const current = useRef<LocalSalonDraft | null>(null);
  const owned = useRef(false);
  const opted = useRef(false);
  const required = useRef(false);
  const blocked = useRef(false);
  const editBeforeCommit = useRef(false);
  const fenceRequested = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState<LocalSalonDraft | null>(null);
  const [ownsSaved, setOwnsSaved] = useState(false);
  const [message, setMessage] = useState('自動保存はオフです。');
  useEffect(() => { latest.current = props; });

  function serial<T>(action: () => Promise<T>): Promise<T> {
    const job = queue.current.then(action, action);
    queue.current = job.then(() => undefined, () => undefined);
    return job;
  }
  function remember(value: LocalSalonDraft | null) {
    current.current = value;
    if (mounted.current) setSaved(value);
  }
  function takeOwnership(value: boolean) {
    owned.current = value;
    if (mounted.current) setOwnsSaved(value);
  }
  function stop() {
    opted.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (mounted.current) setEnabled(false);
  }
  function attention() { if (mounted.current) latest.current.onAttention?.(); }
  function failed(error: unknown) { blocked.current = true; stop(); if (mounted.current) setMessage(failureMessage(error)); attention(); }
  async function save(values: SalonFormValues, photos: readonly (File | null)[]) {
    const result = await saveLocalSalonDraft(values, photos, current.current?.revision ?? null);
    remember(result); takeOwnership(true);
    if (mounted.current) setMessage('保存しました。');
    return result;
  }
  function schedule() {
    if (!opted.current || fenceRequested.current || !latest.current.canSave()) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void serial(async () => {
        if (!opted.current || fenceRequested.current || !latest.current.canSave()) return;
        if (mounted.current) setBusy(true);
        try { await save(latest.current.getValues(), latest.current.photos); }
        catch (error) { failed(error); }
        finally { if (mounted.current) setBusy(false); }
      });
    }, 400);
  }

  useEffect(() => {
    mounted.current = true;
    void serial(async () => {
      try {
        const value = await readLocalSalonDraft(); remember(value);
        if (mounted.current && value?.state === 'saved') setMessage('この端末に送信前の下書きがあります。「下書きを復元」で戻せます。');
        if (value?.state === 'locked' || value?.state === 'saved') attention();
        if (mounted.current) setReady(true);
      } catch (error) { failed(error); }
    });
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); };
  // Initializing once must not reset the opt-in or revision on form rerenders.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const subscription = props.watch(() => schedule());
    return () => subscription.unsubscribe();
  }, [props.watch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { schedule(); }, [props.photos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const resetAfterCleanup = () => {
      stop(); takeOwnership(false); required.current = false; editBeforeCommit.current = false;
      fenceRequested.current = false; remember(null);
      void serial(async () => {
        try {
          remember(await readLocalSalonDraft()); blocked.current = false;
          if (mounted.current) { setReady(true); setMessage('下書きを削除しました。'); }
        } catch (error) { failed(error); }
      });
    };
    window.addEventListener(CLIENT_CLEANUP_COMPLETED_EVENT, resetAfterCleanup);
    return () => window.removeEventListener(CLIENT_CLEANUP_COMPLETED_EVENT, resetAfterCleanup);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    async beforeSubmit(values, photos) {
      if (!required.current) {
        // A failed opted-in save/fence is not permission to fall back to an
        // unprotected transport. A fresh explicit opt-in can retry the save.
        return !fenceRequested.current;
      }
      if (blocked.current) return false;
      fenceRequested.current = true;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      return serial(async () => {
        if (mounted.current) setBusy(true);
        try {
          if (current.current?.state === 'locked') {
            if (!owned.current || !current.current.backup) throw new SalonLocalDraftError('locked');
            if (editBeforeCommit.current) {
              remember(await replaceLockedLocalSalonDraft(values, photos, current.current.revision));
              editBeforeCommit.current = false;
            } else {
              const latestBackup = await exportSalonDraftBackup(values, photos);
              if (await latestBackup.text() !== await current.current.backup.text()) throw new SalonLocalDraftError('conflict');
            }
          } else { await save(values, photos); }
          const locked = await lockLocalSalonDraft(current.current!.revision);
          remember(locked);
          if (mounted.current) setMessage('送信したため、この下書きは復元できなくなりました。');
          return true;
        } catch (error) { failed(error); return false; }
        finally { if (mounted.current) setBusy(false); }
      });
    },
    async confirmed() {
      stop(); required.current = false;
      await serial(async () => {
        if (!owned.current || !current.current) return;
        try {
          remember(await clearLocalSalonDraft(current.current.revision));
          if (mounted.current) setMessage('受付を確認したので、下書きを削除しました。');
        } catch (error) {
          if (mounted.current) setMessage('受付は完了しましたが、下書きを消せませんでした。「下書きを削除」を押してください。');
          throw error;
        }
      });
    },
    async rejectedBeforeCommit() {
      await serial(async () => {
        if (!owned.current || current.current?.state !== 'locked') return;
        try {
          const value = await readLocalSalonDraft();
          if (value?.state !== 'locked' || value.revision !== current.current.revision || !value.backup) throw new SalonLocalDraftError('conflict');
          editBeforeCommit.current = true;
          if (mounted.current) setMessage('申込はまだ確定していません。直して送り直せます。');
        } catch (error) { failed(error); throw error; }
      });
    },
    async adoptManualBackup(blob) {
      return serial(async () => {
        try {
          const value = await readLocalSalonDraft();
          if (value?.state === 'locked') throw new SalonLocalDraftError('locked');
          if (!value?.backup) {
            stop(); remember(value); takeOwnership(false); required.current = false;
            blocked.current = false; fenceRequested.current = false; editBeforeCommit.current = false;
            return true;
          }
          const savedBackup = await restoreLocalSalonDraft(value.revision);
          if (await blob.text() !== await savedBackup.text()) {
            if (mounted.current) setMessage('この端末に別の下書きがあります。「下書きを削除」してから読み込んでください。');
            return false;
          }
          const checked = await readLocalSalonDraft();
          if (checked?.state !== 'saved' || checked.revision !== value.revision) throw new SalonLocalDraftError('conflict');
          remember(checked); takeOwnership(true); required.current = true; blocked.current = false;
          return true;
        } catch (error) { failed(error); throw error; }
      });
    },
  }));

  function enable() {
    if (!ready || busy || current.current?.state === 'locked'
      || (current.current?.state === 'saved' && !owned.current) || !latest.current.canSave()) return;
    opted.current = true; required.current = true; blocked.current = false; fenceRequested.current = false; setEnabled(true); setBusy(true);
    void serial(async () => {
      try {
        if (!latest.current.canSave()) throw new SalonLocalDraftError('locked');
        await save(latest.current.getValues(), latest.current.photos);
      } catch (error) { failed(error); }
      finally { if (mounted.current) setBusy(false); }
    });
  }
  function restore() {
    if (!current.current || !latest.current.canRestore()) return;
    const revision = current.current.revision;
    setBusy(true);
    void serial(async () => {
      try {
        const backup = await restoreLocalSalonDraft(revision);
        if (!latest.current.canRestore()) throw new SalonLocalDraftError('locked');
        await latest.current.onRestore(backup);
        takeOwnership(true); required.current = true;
        if (mounted.current) setMessage('下書きを読み込みました。');
      } catch (error) { failed(error); }
      finally { if (mounted.current) setBusy(false); }
    });
  }
  function clear() {
    if (!current.current) return;
    stop(); required.current = false; fenceRequested.current = true;
    setBusy(true);
    void serial(async () => {
      try {
        remember(await clearLocalSalonDraft(current.current!.revision)); takeOwnership(false);
        if (current.current?.state !== 'locked') fenceRequested.current = false;
        if (mounted.current) setMessage('下書きを削除しました（画面の入力はそのままです）。');
      } catch (error) { failed(error); }
      finally { if (mounted.current) setBusy(false); }
    });
  }

  return <section aria-label="この端末の下書き" className="text-sm">
    <p className="mb-4 font-medium">氏名・連絡先・写真を保存します。共有の端末では使わないでください。</p>
    <h3 className="font-medium">この端末に自動保存</h3>
    <p className="mt-1 text-(--ecru-muted)">7日間、このブラウザーに保存します。</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {enabled ? <button type="button" onClick={stop} disabled={busy} className={DRAFT_BUTTON}>自動保存を止める</button>
        : <button type="button" onClick={enable} disabled={!ready || busy || saved?.state === 'locked' || (saved?.state === 'saved' && !ownsSaved) || !props.canSave()} className={DRAFT_BUTTON}>この端末で下書きを自動保存する</button>}
      <button type="button" onClick={restore} disabled={!ready || busy || saved?.state !== 'saved' || !props.canRestore()} className={DRAFT_BUTTON}>下書きを復元</button>
      {/* 削除は取り消せないので、他の操作と見た目を分ける。 */}
      <button type="button" onClick={clear} disabled={!ready || busy || !saved?.backup} className={DRAFT_DANGER_BUTTON}>下書きを削除</button>
    </div>
    <p aria-live="polite" className="mt-2">{busy ? '確認しています…' : message}</p>
    {saved?.backup && <p className="mt-2">保存期限: {new Date(saved.expiresAt).toLocaleString('ja-JP')}</p>}
    {/* 送信に使った下書きは、タブを閉じても再起動しても復元できないことを常に示す（状態の文言は上書きされるため別に出す）。 */}
    {saved?.state === 'locked' && <p className="mt-2">送信に使った下書きのため、復元できません。受付状況をご確認ください。</p>}
      </section>;
});
