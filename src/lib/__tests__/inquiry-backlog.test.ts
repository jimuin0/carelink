jest.mock('../alert', () => ({ alertWarning: jest.fn() }));
jest.mock('../platform-mail-read', () => ({ readMailReplyEvidence: jest.fn() }));

import { alertWarning } from '../alert';
import { readMailReplyEvidence } from '../platform-mail-read';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyInquiryBacklog, reportInquiryBacklog, UNREPLIED_DAYS, REPLIED_OPEN_DAYS, INQUIRY_TYPE_OPTIONS } from '../inquiry-backlog';

const now = new Date('2026-11-17T06:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sentMail = (contactId: string) => ({ id: uuid(900), contact_id: contactId, state: 'sent', delivery_status: 'delivered' });
const draftMail = (contactId: string) => ({ id: uuid(901), contact_id: contactId, state: 'draft', delivery_status: null });
const legacyReply = (contactId: string) => ({ id: uuid(902), contact_id: contactId, author_name: '運営', body: '返信', is_internal: false,
  created_at: daysAgo(1), sent_at: daysAgo(1), delivery_abandoned_at: null });
const empty = { messages: [], replies: [] };

describe('classifyInquiryBacklog', () => {
  test('返信の記録が無く1日以上たったものは未返信', () => {
    expect(classifyInquiryBacklog([{ id: uuid(1), created_at: daysAgo(UNREPLIED_DAYS) }], empty, now))
      .toEqual([expect.objectContaining({ id: uuid(1), ageDays: UNREPLIED_DAYS, reason: 'unreplied' })]);
  });

  test('受信から1日未満の未返信はまだ知らせない（境界）', () => {
    expect(classifyInquiryBacklog([{ id: uuid(1), created_at: daysAgo(0.9) }], empty, now)).toEqual([]);
  });

  test('下書きだけでは返信とみなさない（下書きのまま止まる事故）', () => {
    const items = classifyInquiryBacklog([{ id: uuid(1), created_at: daysAgo(50) }], { messages: [draftMail(uuid(1))], replies: [] } as never, now);
    expect(items).toEqual([expect.objectContaining({ id: uuid(1), ageDays: 50, reason: 'unreplied' })]);
  });

  test('返信済みでも7日以上未完了なら知らせ、7日未満なら知らせない（境界）', () => {
    const evidence = { messages: [sentMail(uuid(1)), sentMail(uuid(2))], replies: [] } as never;
    expect(classifyInquiryBacklog([
      { id: uuid(1), created_at: daysAgo(REPLIED_OPEN_DAYS) },
      { id: uuid(2), created_at: daysAgo(REPLIED_OPEN_DAYS - 0.5) },
    ], evidence, now)).toEqual([expect.objectContaining({ id: uuid(1), ageDays: REPLIED_OPEN_DAYS, reason: 'repliedOpen' })]);
  });

  test('旧形式の返信も返信として扱い、他の問い合わせの返信は混ぜない', () => {
    const items = classifyInquiryBacklog([
      { id: uuid(1), created_at: daysAgo(3) },
      { id: uuid(2), created_at: daysAgo(3) },
    ], { messages: [], replies: [legacyReply(uuid(1))] } as never, now);
    expect(items).toEqual([expect.objectContaining({ id: uuid(2), ageDays: 3, reason: 'unreplied' })]);
  });

  test('作成日時が無い行は漏れ側（最も古い）に倒し、古い順に並べる', () => {
    const items = classifyInquiryBacklog([
      { id: uuid(1), created_at: daysAgo(2) },
      { id: uuid(2), created_at: null },
      { id: uuid(3), created_at: daysAgo(30) },
    ], empty, now);
    expect(items.map((item) => item.id)).toEqual([uuid(2), uuid(3), uuid(1)]);
    expect(items[0].ageDays).toBe(Number.MAX_SAFE_INTEGER);
  });
});

function fakeDb(pages: { data: unknown; error: unknown }[]) {
  const calls: Record<string, unknown[]>[] = [];
  const from = jest.fn(() => {
    const call: Record<string, unknown[]> = {};
    calls.push(call);
    const query: Record<string, unknown> = {};
    for (const key of ['select', 'in', 'is', 'order']) query[key] = jest.fn((...args: unknown[]) => { call[key] = args; return query; });
    query.range = jest.fn(async (...args: unknown[]) => { call.range = args; return pages.shift() ?? { data: [], error: null }; });
    return query;
  });
  return { db: { from } as never, from, calls };
}

describe('reportInquiryBacklog', () => {
  const env = process.env.NEXT_PUBLIC_BASE_URL;
  beforeEach(() => { jest.clearAllMocks(); delete process.env.NEXT_PUBLIC_BASE_URL; });
  afterAll(() => { process.env.NEXT_PUBLIC_BASE_URL = env; });

  test('未完了の問い合わせだけを読み、お名前・受付日・種類・タブを Slack に出す（メール・電話・本文は載せない）', async () => {
    const { db, calls } = fakeDb([{ data: [
      { id: uuid(1), created_at: '2026-09-18T15:30:00Z', ticket_status: 'open', inquiry_type: '施設掲載について（オーナー向け）', name: ' 山田 太郎 ', phone: '090-1234-5678', email: 'a@example.invalid', message: '本文' },
      { id: uuid(2), created_at: daysAgo(20), name: 'あ'.repeat(25), ticket_status: 'in_progress', inquiry_type: null },
      { id: uuid(3), created_at: null, name: '', ticket_status: 'unknown', inquiry_type: 'その他' },
      { id: '01234567-0000-4000-8000-000000000004', created_at: daysAgo(5), name: null, ticket_status: 'waiting', inquiry_type: '佐藤花子です。腰の痛みについて相談したい' },
    ], error: null }]);
    (readMailReplyEvidence as jest.Mock).mockResolvedValue({ messages: [sentMail(uuid(2))], replies: [] });

    await expect(reportInquiryBacklog(db, now)).resolves.toEqual({ unreplied: 3, repliedOpen: 1 });
    expect(calls[0].select).toEqual(['id,created_at,name,ticket_status,inquiry_type']);
    expect(calls[0].in).toEqual(['ticket_status', ['open', 'in_progress', 'waiting']]);
    expect(calls[0].is).toEqual(['resolved_at', null]);
    expect(readMailReplyEvidence).toHaveBeenCalledWith(db, [uuid(1), uuid(2), uuid(3), '01234567-0000-4000-8000-000000000004']);

    expect(alertWarning).toHaveBeenCalledTimes(1);
    const [message, opts] = (alertWarning as jest.Mock).mock.calls[0];
    expect(message).toContain('未完了が4件');
    expect(opts.category).toBe('完了未確認');
    expect(opts.extra).toEqual({
      adminUrl: 'https://carelink-jp.com/admin/inquiries',
      howToClose: expect.stringContaining('解決済み'),
      unreplied: [
        'お名前なし・受付日不明・その他・状態不明タブ（日時不明）',
        '山田 太郎様・9/19受付・施設掲載について（オーナー向け）・新着タブ（59日）',
        'お名前なし・11/12受付・その他の種類・返信待ちタブ（5日）',
      ],
      repliedOpen: [`${'あ'.repeat(20)}…様・10/28受付・種類不明・対応中タブ（20日）`],
      omitted: 0,
    });
    // 案内が一覧より先（1500 文字の切り詰めで消えない）
    expect(Object.keys(opts.extra).slice(0, 2)).toEqual(['adminUrl', 'howToClose']);
    // メール・電話・本文も、種類欄に書かれた自由記述も、受付番号も載らない
    const sent = JSON.stringify([message, opts]);
    for (const secret of ['a@example.invalid', '090-1234-5678', '本文', '佐藤花子', '腰の痛み', '01234567', '00000000']) expect(sent).not.toContain(secret);
  });

  test('知らせるものが無ければ Slack に出さない', async () => {
    const { db } = fakeDb([{ data: [], error: null }]);
    await expect(reportInquiryBacklog(db, now)).resolves.toEqual({ unreplied: 0, repliedOpen: 0 });
    expect(readMailReplyEvidence).not.toHaveBeenCalled();
    expect(alertWarning).not.toHaveBeenCalled();
  });

  test('片方の区分が空なら「なし」と出し、上限を超えた分は省略件数に数え、設定済みの URL を使う', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://staging.example.invalid';
    const rows = Array.from({ length: 150 }, (_, index) => ({ id: uuid(index), created_at: daysAgo(3) }));
    const { db } = fakeDb([{ data: rows, error: null }]);
    (readMailReplyEvidence as jest.Mock).mockResolvedValue(empty);

    await expect(reportInquiryBacklog(db, now)).resolves.toEqual({ unreplied: 150, repliedOpen: 0 });
    expect(readMailReplyEvidence).toHaveBeenCalledTimes(2);
    expect((readMailReplyEvidence as jest.Mock).mock.calls[0][1]).toHaveLength(100);
    expect((readMailReplyEvidence as jest.Mock).mock.calls[1][1]).toHaveLength(50);
    const opts = (alertWarning as jest.Mock).mock.calls[0][1];
    expect(opts.extra.repliedOpen).toBe('なし');
    expect(opts.extra.unreplied).toHaveLength(10);
    expect(opts.extra.omitted).toBe(140);
    expect(opts.extra.adminUrl).toBe('https://staging.example.invalid/admin/inquiries');
  });

  test('現在時刻の既定値を使い、返信済みだけなら未返信側は「なし」と出す', async () => {
    const { db } = fakeDb([{ data: [{ id: uuid(1), created_at: '2020-01-01T00:00:00Z' }], error: null }]);
    (readMailReplyEvidence as jest.Mock).mockResolvedValue({ messages: [sentMail(uuid(1))], replies: [] });
    await expect(reportInquiryBacklog(db)).resolves.toEqual({ unreplied: 0, repliedOpen: 1 });
    expect((alertWarning as jest.Mock).mock.calls[0][1].extra.unreplied).toBe('なし');
  });

  test('省略件数は区分ごとに数える（未返信11件・返信済み0件なら1件）', async () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({ id: uuid(index), created_at: daysAgo(3) }));
    const { db } = fakeDb([{ data: rows, error: null }]);
    (readMailReplyEvidence as jest.Mock).mockResolvedValue(empty);
    await reportInquiryBacklog(db, now);
    expect((alertWarning as jest.Mock).mock.calls[0][1].extra.omitted).toBe(1);
  });

  test('種類の選択肢はお問い合わせフォームの選択肢と一致する', () => {
    const page = readFileSync(join(__dirname, '../../app/contact/page.tsx'), 'utf8');
    const options = [...page.matchAll(/<option value="([^"]+)">/g)].map((match) => match[1]);
    expect(options).toEqual([...INQUIRY_TYPE_OPTIONS]);
  });

  test('取得に失敗したら「0件」にせず throw する', async () => {
    const { db } = fakeDb([{ data: null, error: { message: 'db down' } }]);
    await expect(reportInquiryBacklog(db, now)).rejects.toThrow('Inquiry backlog lookup failed');
    expect(alertWarning).not.toHaveBeenCalled();
  });
});
