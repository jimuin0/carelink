import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import MailConsole from '../MailConsole';
import { PLATFORM_MAIL_FROM } from '@/lib/platform-mail-contract';
jest.mock('@/components/Modal', () => ({ __esModule: true, default: ({ open, title, children, footer }: { open: boolean; title: string; children: React.ReactNode; footer: React.ReactNode }) => open ? <section role="dialog" aria-label={title}><h2>{title}</h2>{children}{footer}</section> : null }));
const id = '11111111-1111-4111-8111-111111111111';
const providerId = '22222222-2222-4222-8222-222222222222';
const at = '2026-10-25T12:00:00Z';
const contact = { id, name: '合成問い合わせ', email: 'synthetic@example.invalid', phone: null, message: '架空の問い合わせです。', inquiry_type: '掲載について', created_at: at,
  ticket_status: 'open', priority: 'normal', ticket_notes: null, resolved_at: null, traffic_source: null };
const base = { id, revision: 1, contact_id: null, recipient: contact.email, subject: 'ご案内', body: '架空の本文', state: 'draft', scheduled_at: null, reserved_at: null,
  accepted_at: null, provider_message_id: null, delivery_status: null, envelope: null, created_at: at, updated_at: at };
const mockFetch = jest.fn();
let records: typeof base[], commands: Record<string, unknown>[];
let saveFailure = false, unknown = false, mismatch = false;
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
beforeEach(() => {
  records = []; commands = []; saveFailure = false; unknown = false; mismatch = false;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: mockFetch });
  mockFetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (!init?.method) {
      if (url.includes('contactId=')) return response({ contact });
      if (url.startsWith('/api/admin/inquiries')) return response({ contacts: [contact], nextCursor: null });
      return response({ messages: records, nextCursor: null });
    }
    const command = JSON.parse(init.body as string); commands.push(command);
    if (command.action === 'save') {
      if (saveFailure) return response({ error: '保存できません。入力内容は保持されています。' }, 409);
      const draft = command.draft;
      const mail = { ...base, id: mismatch ? providerId : draft.id, revision: draft.revision + 1, contact_id: draft.contactId, recipient: draft.to,
        subject: draft.subject, body: draft.body, scheduled_at: draft.scheduledAt };
      records = [mail]; return response({ mail });
    }
    const stored = records.find(item => item.id === command.id)!;
    const mail = { ...stored, state: command.action === 'cancel' ? 'cancelled' : unknown ? 'pending' : stored.scheduled_at ? 'scheduled' : 'sent',
      envelope: { from: PLATFORM_MAIL_FROM, replyTo: 'support@carelink-jp.com', to: stored.recipient, subject: stored.subject, text: stored.body },
      reserved_at: at, provider_message_id: unknown ? null : providerId, accepted_at: unknown ? null : at, delivery_status: unknown ? null : 'accepted' };
    records = [mail as typeof base]; return response({ mail, ...(unknown ? { warning: '送信結果を確認できません。' } : {}) }, unknown ? 202 : 200);
  });
});
afterEach(() => jest.restoreAllMocks());
async function ready(props = {}) { render(<MailConsole {...props} />); await screen.findByRole('button', { name: /合成問い合わせ/ }); }
async function fill() {
  fireEvent.click(screen.getByRole('button', { name: /新規作成/ }));
  fireEvent.change(screen.getByLabelText('宛先'), { target: { value: contact.email } });
  fireEvent.change(screen.getByLabelText('件名'), { target: { value: 'ご案内' } });
  fireEvent.change(screen.getByLabelText('本文'), { target: { value: '架空の本文' } });
}
test('fixed business identity; mounting never sends or creates a draft', async () => {
  await ready(); expect(screen.getByText('差出人：' + PLATFORM_MAIL_FROM)).toBeInTheDocument(); expect(commands).toHaveLength(0);
});
test('draft save preserves the written content across folder selection', async () => {
  await ready(); await fill(); fireEvent.click(screen.getByRole('button', { name: '下書き保存' })); await screen.findByText('下書きを保存しました。');
  expect(commands.map(item => item.action)).toEqual(['save']);
  fireEvent.click(screen.getByRole('button', { name: '下書き', exact: true })); await screen.findByRole('button', { name: /ご案内.*synthetic/ });
  fireEvent.click(screen.getByRole('button', { name: /ご案内.*synthetic/ })); expect(screen.getByLabelText('本文')).toHaveValue('架空の本文');
});
test('preview is saved before explicit send, not sent by opening it', async () => {
  await ready(); await fill(); fireEvent.click(screen.getByRole('button', { name: '送信内容を確認' }));
  const dialog = await screen.findByRole('dialog', { name: '送信内容の確認' });
  expect(commands.map(item => item.action)).toEqual(['save']); expect(within(dialog).getByText('差出人：' + PLATFORM_MAIL_FROM)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'この内容で送信' }));
  await waitFor(() => expect(commands.map(item => item.action)).toEqual(['save', 'send']));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(screen.getByText('送信受付済み')).toBeInTheDocument();
});
test('schedule uses Japan time and cancellation requires a separate confirmation', async () => {
  await ready(); await fill();
  const local = new Date(Date.now() + 11 * 3600000).toISOString().slice(0, 16);
  fireEvent.change(screen.getByLabelText('送信日時（任意・日本時間）'), { target: { value: local } });
  fireEvent.click(screen.getByRole('button', { name: '予約内容を確認' }));
  const dialog = await screen.findByRole('dialog', { name: '送信内容の確認' });
  expect((commands[0].draft as { scheduledAt: string }).scheduledAt).toBe(new Date(local + ':00+09:00').toISOString());
  fireEvent.click(within(dialog).getByRole('button', { name: '予約送信を確定' }));
  await screen.findByRole('button', { name: '予約を取り消す' }); fireEvent.click(screen.getByRole('button', { name: '予約を取り消す' }));
  expect(commands.filter(item => item.action === 'cancel')).toHaveLength(0);
  fireEvent.click(within(screen.getByRole('dialog', { name: '送信予約を取り消す' })).getByRole('button', { name: '取り消しを確定' }));
  await waitFor(() => expect(screen.getByText('予約を取り消しました')).toBeInTheDocument());
});
test('failed saves do not erase the draft or produce a send', async () => {
  await ready(); await fill(); saveFailure = true; fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));
  await screen.findByText('保存できません。入力内容は保持されています。'); expect(screen.getByLabelText('本文')).toHaveValue('架空の本文'); expect(commands.some(item => item.action === 'send')).toBe(false);
});
test('mismatched saved receipt cannot open a send preview', async () => {
  await ready(); await fill(); mismatch = true; fireEvent.click(screen.getByRole('button', { name: '送信内容を確認' }));
  await screen.findByText('対象メールの保存結果を確認できませんでした。'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByLabelText('本文')).toHaveValue('架空の本文');
});
test('unknown result freezes the content and reuses the original operation for recovery', async () => {
  await ready(); await fill(); unknown = true; fireEvent.click(screen.getByRole('button', { name: '送信内容を確認' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'この内容で送信' }));
  await screen.findByText('送信結果を確認できません。'); expect(screen.queryByLabelText('本文')).not.toBeInTheDocument();
  unknown = false; fireEvent.click(screen.getByRole('button', { name: '送信状況を確認' }));
  await screen.findByText('送信受付済み'); const sends = commands.filter(item => item.action === 'send'); expect(sends).toHaveLength(2); expect(sends[0].id).toBe(sends[1].id);
});
test('unsaved edits are protected from navigation and reload', async () => {
  await ready(); await fill();
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '下書き', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: '編集を続ける' })); expect(screen.getByLabelText('本文')).toHaveValue('架空の本文');
  fireEvent.click(screen.getByRole('button', { name: '下書き', exact: true })); fireEvent.click(await screen.findByRole('button', { name: '保存せずに移動' })); await waitFor(() => expect(screen.queryByLabelText('本文')).not.toBeInTheDocument());
});
test('reply recipient is the original stored contact and cannot be edited', async () => {
  await ready(); fireEvent.click(screen.getByRole('button', { name: /合成問い合わせ/ })); fireEvent.click(screen.getByRole('button', { name: '返信を書く' }));
  expect(screen.getByLabelText('宛先')).toHaveValue(contact.email); expect(screen.getByLabelText('宛先')).toHaveAttribute('readonly');
});
test('late selected-contact response cannot overwrite a new composition', async () => {
  let resolve!: (value: unknown) => void; const held = new Promise(done => { resolve = done; });
  const implementation = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation((url: string, init?: RequestInit) => url.includes('contactId=') ? held : implementation(url, init));
  await ready({ initialContactId: id }); await fill();
  await act(async () => { resolve(response({ contact })); await held; });
  expect(screen.getByLabelText('本文')).toHaveValue('架空の本文'); expect(screen.getByLabelText('宛先')).not.toHaveAttribute('readonly');
});
test('failed or unauthorized list never reports an empty successful inbox', async () => {
  mockFetch.mockResolvedValue(response({}, 503)); render(<MailConsole />); await screen.findByRole('alert'); expect(screen.queryByText('メールはありません。')).not.toBeInTheDocument();
});
test('ordinary account sees no composer or customer messages', async () => {
  mockFetch.mockResolvedValue(response({}, 403)); render(<MailConsole />); await screen.findByText('運営アカウントでログインしてください'); expect(screen.queryByRole('button', { name: /新規作成/ })).not.toBeInTheDocument();
});

test('selecting the current folder reloads it instead of leaving a blank list', async () => {
  await ready(); await fill(); fireEvent.click(screen.getByRole('button', { name: '下書き保存' })); await screen.findByText('下書きを保存しました。');
  fireEvent.click(screen.getByRole('button', { name: '下書き', exact: true })); await screen.findByRole('button', { name: /ご案内.*synthetic/ });
  fireEvent.click(screen.getByRole('button', { name: /ご案内.*synthetic/ }));
  fireEvent.click(screen.getByRole('button', { name: '下書き', exact: true })); await screen.findByRole('button', { name: /ご案内.*synthetic/ });
});
