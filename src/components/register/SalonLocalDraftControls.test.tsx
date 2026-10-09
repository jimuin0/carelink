import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import type { SalonFormValues } from '@/lib/validations';
import { SalonLocalDraftControls, type SalonLocalDraftHandle } from './SalonLocalDraftControls';
import { SalonLocalDraftError, type LocalSalonDraft } from '@/lib/salon-local-draft';

jest.mock('@/lib/salon-local-draft', () => ({
  ...jest.requireActual('@/lib/salon-local-draft'),
  readLocalSalonDraft: jest.fn(), saveLocalSalonDraft: jest.fn(), lockLocalSalonDraft: jest.fn(),
  restoreLocalSalonDraft: jest.fn(), clearLocalSalonDraft: jest.fn(), replaceLockedLocalSalonDraft: jest.fn(),
}));
jest.mock('@/lib/salon-draft-backup', () => ({ exportSalonDraftBackup: jest.fn() }));
const api = jest.requireMock('@/lib/salon-local-draft') as Record<string, jest.Mock>;
const exporter = jest.requireMock('@/lib/salon-draft-backup').exportSalonDraftBackup as jest.Mock;
const backup = { text: async () => 'verified original' } as Blob;
const values = { facility_name: '未送信の入力' } as SalonFormValues;
const sample = (revision: number, state: LocalSalonDraft['state'] = 'saved'): LocalSalonDraft => ({
  id: 'registration-input', revision, state, backup, sha256: 'a'.repeat(64), updatedAt: 1, expiresAt: Date.now() + 100000,
});
let current: LocalSalonDraft | null;
let changed: () => void;
beforeEach(() => {
  jest.clearAllMocks(); current = null;
  api.readLocalSalonDraft.mockImplementation(async () => current);
  api.saveLocalSalonDraft.mockImplementation(async (_values, _photos, expected) => { current = sample((expected ?? 0) + 1); return current; });
  api.lockLocalSalonDraft.mockImplementation(async revision => { current = sample(revision + 1, 'locked'); return current; });
  api.restoreLocalSalonDraft.mockResolvedValue(backup);
  api.replaceLockedLocalSalonDraft.mockImplementation(async (_values, _photos, revision) => { current = sample(revision + 1, 'locked'); return current; });
  api.clearLocalSalonDraft.mockImplementation(async revision => ({ ...sample(revision + 1, current?.state === 'locked' ? 'locked' : 'cleared'), backup: null, sha256: null }));
  exporter.mockResolvedValue(backup);
});
function mount(over: Record<string, unknown> = {}) {
  const ref = createRef<SalonLocalDraftHandle>();
  const onRestore = jest.fn().mockResolvedValue(undefined);
  const unsubscribe = jest.fn();
  const props = { getValues: () => values, watch: jest.fn(callback => { changed = callback; return { unsubscribe }; }),
    photos: [] as (File | null)[], canSave: () => true, canRestore: () => true, onRestore, ...over };
  const view = render(<SalonLocalDraftControls ref={ref} {...props} />);
  return { ref, onRestore, unsubscribe, props, ...view };
}
const enable = async () => { await waitFor(() => expect(screen.getByRole('button', { name: 'この端末で下書きを自動保存する（7日間）' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'この端末で下書きを自動保存する（7日間）' }));
  await waitFor(() => expect(screen.getByText('入力と元の写真を保存し、読み戻して確認しました。')).toBeInTheDocument()); };
async function before(ref: React.RefObject<SalonLocalDraftHandle | null>) {
  let result: boolean | undefined;
  await act(async () => { result = await ref.current!.beforeSubmit(values, []); }); return result;
}

test('without explicit opt-in there are no writes, new checkboxes or transport fences', async () => {
  const view = mount(); await waitFor(() => expect(screen.getByText('自動保存は無効です。')).toBeInTheDocument());
  expect(await before(view.ref)).toBe(true); expect(api.saveLocalSalonDraft).not.toHaveBeenCalled();
  expect(api.lockLocalSalonDraft).not.toHaveBeenCalled(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
test('opt-in autosaves, then saves latest input and commits the fence before allowing transport', async () => {
  const view = mount(); await enable(); expect(api.saveLocalSalonDraft).toHaveBeenCalledWith(values, [], null);
  expect(await before(view.ref)).toBe(true);
  expect(api.saveLocalSalonDraft).toHaveBeenLastCalledWith(values, [], 1);
  expect(api.lockLocalSalonDraft).toHaveBeenCalledWith(2);
  expect(screen.getByRole('button', { name: '端末の下書きを復元' })).toBeDisabled();
  await act(async () => { await view.ref.current!.confirmed(); });
  expect(api.clearLocalSalonDraft).toHaveBeenCalledWith(3);
  expect(screen.getByText('受付を確認し、端末に保存した入力と写真を削除しました。')).toBeInTheDocument();
});
test('failed autosave cannot silently become an opted-off unfenced submission', async () => {
  const view = mount(); api.saveLocalSalonDraft.mockRejectedValue(new SalonLocalDraftError('storage'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'この端末で下書きを自動保存する（7日間）' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'この端末で下書きを自動保存する（7日間）' }));
  await waitFor(() => expect(screen.getByText(/端末の下書きを保存・確認できませんでした/)).toBeInTheDocument());
  expect(await before(view.ref)).toBe(false); expect(api.lockLocalSalonDraft).not.toHaveBeenCalled();
});
test.each(['storage', 'conflict', 'locked'] as const)('pretransport %s failure prevents submission and leaves visible recovery', async code => {
  const view = mount(); await enable(); api.lockLocalSalonDraft.mockRejectedValue(new SalonLocalDraftError(code));
  expect(await before(view.ref)).toBe(false); expect(screen.getByLabelText('この端末の下書き').textContent).not.toMatch(/保存し、読み戻して確認/);
  expect(await before(view.ref)).toBe(false);
});
test('confirmed deletion failure keeps a visible locked warning, without changing accepted status', async () => {
  const view = mount(); await enable(); await before(view.ref);
  api.clearLocalSalonDraft.mockRejectedValue(new SalonLocalDraftError('storage'));
  await act(async () => { await expect(view.ref.current!.confirmed()).rejects.toMatchObject({ code: 'storage' }); });
  expect(screen.getByText(/受付は確認済みですが/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '端末の下書きを復元' })).toBeDisabled();
});
test('saved inputs require an explicit restore and submission-context permission', async () => {
  current = sample(6); const view = mount();
  await waitFor(() => expect(screen.getByRole('button', { name: '端末の下書きを復元' })).toBeEnabled());
  expect(view.onRestore).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '端末の下書きを復元' }));
  await waitFor(() => expect(view.onRestore).toHaveBeenCalledWith(backup));
  expect(api.restoreLocalSalonDraft).toHaveBeenCalledWith(6);
  expect(api.saveLocalSalonDraft).not.toHaveBeenCalled();
});
test('a locked draft after reopening cannot restore, opt in or be unlocked by deleting its photos', async () => {
  current = sample(6, 'locked'); const view = mount();
  await waitFor(() => expect(screen.getByText(/送信に使用した下書きです/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: '端末の下書きを復元' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'この端末で下書きを自動保存する（7日間）' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '端末の下書きを削除' }));
  await waitFor(() => expect(api.clearLocalSalonDraft).toHaveBeenCalledWith(6));
  expect(await before(view.ref)).toBe(false); expect(view.onRestore).not.toHaveBeenCalled();
});
test('stopping autosave preserves the existing input fence until explicit clear', async () => {
  const view = mount(); await enable(); fireEvent.click(screen.getByRole('button', { name: '自動保存を止める' }));
  expect(await before(view.ref)).toBe(true); expect(api.lockLocalSalonDraft).toHaveBeenCalled();
});
test('debounced input and photo changes serialize saves with fresh revisions; unmount unsubscribes', async () => {
  const view = mount(); await enable();
  act(() => changed());
  await waitFor(() => expect(api.saveLocalSalonDraft).toHaveBeenCalledTimes(2));
  expect(api.saveLocalSalonDraft).toHaveBeenLastCalledWith(values, [], 1);
  const photos = [new File(['image'], 'photo.png', { type: 'image/png' })];
  view.rerender(<SalonLocalDraftControls ref={view.ref} {...view.props} photos={photos} />);
  await waitFor(() => expect(api.saveLocalSalonDraft).toHaveBeenCalledTimes(3));
  expect(api.saveLocalSalonDraft).toHaveBeenLastCalledWith(values, photos, 2);
  view.unmount(); expect(view.unsubscribe).toHaveBeenCalled();
});
test('a known pretransport retry accepts only the same fenced original input', async () => {
  const view = mount(); await enable(); expect(await before(view.ref)).toBe(true);
  expect(await before(view.ref)).toBe(true); expect(api.saveLocalSalonDraft).toHaveBeenCalledTimes(2);
  exporter.mockResolvedValue({ text: async () => 'changed input' });
  expect(await before(view.ref)).toBe(false);
});
test('an unavailable database leaves opt-in disabled and initial opted-off submission usable', async () => {
  api.readLocalSalonDraft.mockRejectedValue(new SalonLocalDraftError('unavailable')); const view = mount();
  await waitFor(() => expect(screen.getByText(/端末の下書きを保存・確認できませんでした/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'この端末で下書きを自動保存する（7日間）' })).toBeDisabled();
  expect(await before(view.ref)).toBe(true);
});
test('an explicit never-committed rejection permits a corrected own payload while preserving the lock', async () => {
  const view = mount(); await enable(); await before(view.ref);
  await act(async () => { await view.ref.current!.rejectedBeforeCommit(); });
  exporter.mockResolvedValue({ text: async () => 'corrected photo' });
  expect(await before(view.ref)).toBe(true);
  expect(api.replaceLockedLocalSalonDraft).toHaveBeenCalledWith(values, [], 3);
  expect(screen.getByRole('button', { name: '端末の下書きを復元' })).toBeDisabled();
});
test('a rejection cannot grant edit permission after another tab changes the locked revision', async () => {
  const view = mount(); await enable(); await before(view.ref); current = sample(10, 'locked');
  await act(async () => { await expect(view.ref.current!.rejectedBeforeCommit()).rejects.toMatchObject({ code: 'conflict' }); });
  expect(await before(view.ref)).toBe(false); expect(api.replaceLockedLocalSalonDraft).not.toHaveBeenCalled();
});
test('a fresh manual file is permitted without automatic persistence', async () => {
  const view = mount();
  await act(async () => { expect(await view.ref.current!.adoptManualBackup(backup)).toBe(true); });
  expect(api.saveLocalSalonDraft).not.toHaveBeenCalled(); expect(await before(view.ref)).toBe(true);
});
test('manual adoption after another tab clears the record also stops the earlier autosave opt-in', async () => {
  const view = mount(); await enable(); current = { ...sample(2, 'cleared'), backup: null, sha256: null };
  await act(async () => { expect(await view.ref.current!.adoptManualBackup(backup)).toBe(true); });
  expect(screen.queryByRole('button', { name: '自動保存を止める' })).not.toBeInTheDocument();
  jest.useFakeTimers();
  try { await act(async () => { changed(); jest.advanceTimersByTime(1000); }); }
  finally { jest.useRealTimers(); }
  expect(await before(view.ref)).toBe(true); expect(api.saveLocalSalonDraft).toHaveBeenCalledTimes(1);
});
test('an exact saved manual file is adopted for the eventual fence without opting into autosave', async () => {
  current = sample(6); const view = mount();
  await act(async () => { expect(await view.ref.current!.adoptManualBackup(backup)).toBe(true); });
  expect(api.saveLocalSalonDraft).not.toHaveBeenCalled(); expect(await before(view.ref)).toBe(true);
  expect(api.saveLocalSalonDraft).toHaveBeenCalledWith(values, [], 6);
  expect(api.lockLocalSalonDraft).toHaveBeenCalledWith(7);
});
test('an unrelated manual file cannot overwrite another saved draft', async () => {
  current = sample(6); const view = mount();
  await act(async () => { expect(await view.ref.current!.adoptManualBackup({ text: async () => 'another file' } as Blob)).toBe(false); });
  expect(screen.getByText(/他の下書きがこの端末に保存されています/)).toBeInTheDocument();
  expect(api.saveLocalSalonDraft).not.toHaveBeenCalled(); expect(api.lockLocalSalonDraft).not.toHaveBeenCalled();
});
test('a locked or unverified local record rejects manual import after losing its session selector', async () => {
  current = sample(6, 'locked'); const view = mount();
  await act(async () => { await expect(view.ref.current!.adoptManualBackup(backup)).rejects.toMatchObject({ code: 'locked' }); });
  api.readLocalSalonDraft.mockRejectedValue(new SalonLocalDraftError('storage'));
  await act(async () => { await expect(view.ref.current!.adoptManualBackup(backup)).rejects.toMatchObject({ code: 'storage' }); });
  expect(api.saveLocalSalonDraft).not.toHaveBeenCalled();
});
