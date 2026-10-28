/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { fetchCabinetHolidays, parseCabinetHolidays } from '../cabinet-holidays';

const header = '国民の祝日・休日月日,国民の祝日・休日名称';
const year = (y: number) => ['1/1','2/11','2/23','4/29','5/3','5/4','5/5','8/11','11/3','11/23',
  '2/1','2/2','2/3','2/4'].map(day => `${y}/${day},休日`);
const fixture = [header, ...year(2026), ...year(2027)].join('\n');

test('complete years have explicit coverage and holiday dates', () => {
  const result = parseCabinetHolidays(fixture);
  expect(result?.from).toBe('2026-01-01');
  expect(result?.through).toBe('2027-12-31');
  expect(result?.dates.has('2027-11-23')).toBe(true);
});

test.each([
  '', 'unexpected header', header, `${header}\ninvalid`, `${header}\n2026/02/30,invalid`, `${header}\n2026/1/1,x\n2026/1/1,y`,
  [header, ...year(2026), ...year(2027).slice(0, -1)].join('\n'),
  [header, ...year(2026), ...year(2028)].join('\n'),
])('malformed or incomplete calendar is unknown', value => {
  expect(parseCabinetHolidays(value)).toBeNull();
});

test('正常応答でも本文がない場合は未確認とする', async () => {
  const original = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ok:true,body:null});
  try { expect(await fetchCabinetHolidays()).toBeNull(); } finally { global.fetch = original; }
});

test('network errors do not invent a holiday calendar', async () => {
  const original = global.fetch;
  global.fetch = jest.fn().mockRejectedValue(new Error('network'));
  try { expect(await fetchCabinetHolidays()).toBeNull(); } finally { global.fetch = original; }
});

test('large calendar responses are rejected before parsing', async () => {
  const original = global.fetch;
  global.fetch = jest.fn().mockResolvedValue(new Response(new Uint8Array(100_001)));
  try { expect(await fetchCabinetHolidays()).toBeNull(); } finally { global.fetch = original; }
});

test('error responses do not invent a holiday calendar', async () => {
  const original = global.fetch;
  global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 503 }));
  try { expect(await fetchCabinetHolidays()).toBeNull(); } finally { global.fetch = original; }
});

test('verified calendars are shared briefly, with independent copies and a fresh download after expiry', async () => {
  jest.resetModules();
  const originalFetch = global.fetch;
  const OriginalDecoder = global.TextDecoder;
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  global.fetch = jest.fn().mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1]))));
  global.TextDecoder = class {
    decode(input?: Uint8Array) { return input ? fixture : ''; }
  } as unknown as typeof TextDecoder;
  try {
    const { fetchCabinetHolidays: load } = await import('../cabinet-holidays');
    const [first, second] = await Promise.all([load(), load()]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    first!.dates.clear();
    expect(second!.dates.has('2026-11-03')).toBe(true);
    expect((await load())!.dates.has('2026-11-03')).toBe(true);
    now.mockReturnValue(1_000 + 30 * 60 * 1000);
    expect((await load())!.dates.has('2026-11-03')).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    now.mockReturnValue(1_000 + 60 * 60 * 1000);
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));
    expect(await load()).toBeNull();
    expect((await load())!.dates.has('2026-11-03')).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  } finally {
    global.fetch = originalFetch;
    global.TextDecoder = OriginalDecoder;
    now.mockRestore();
  }
});
