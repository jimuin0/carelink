/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readCompleteAvailabilityStaff, readCompleteMonthAvailability, countConfirmedAvailabilitySlots } from '../availability-results';

const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001`;
const monthRows = () => Array.from({ length: 29 }, (_, i) => ({ d: `2028-02-${String(i + 1).padStart(2, '0')}`, slots: i }));

test('short server pages include the eleventh staff and continue until confirmed empty', async () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ id: id(i + 1) }));
  const read = jest.fn(async (cursor: string) => ({ data: rows.filter(row => row.id > cursor).slice(0, 2), error: null }));
  expect(await readCompleteAvailabilityStaff(read)).toEqual(rows.map(row => row.id));
  expect(read).toHaveBeenCalledTimes(7);
  expect(read).toHaveBeenLastCalledWith(id(11));
});
test('confirmed empty staff collection is empty', async () => {
  expect(await readCompleteAvailabilityStaff(async () => ({ data: [], error: null }))).toEqual([]);
});
test('failure after a successful page never produces a partial staff set', async () => {
  const read = jest.fn().mockResolvedValueOnce({ data: [{ id: id(1) }], error: null })
    .mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'private source error' } });
  await expect(readCompleteAvailabilityStaff(read)).rejects.toThrow('DATABASE_FAILURE:08006');
});
test.each([null, {}, [{}], [{ id: 'not-a-uuid' }]])('unverified staff page is rejected %#', async data => {
  await expect(readCompleteAvailabilityStaff(async () => ({ data, error: null }))).rejects.toThrow('staff page invalid');
});
test.each([[{ id: id(1) }, { id: id(1) }], [{ id: id(2) }, { id: id(1) }]].map(data => [data]))('duplicate or backwards cursor cannot hide more staff %#', async data => {
  await expect(readCompleteAvailabilityStaff(async () => ({ data, error: null }))).rejects.toThrow('cursor did not advance');
});
test('page budget exhaustion is visible, never a partial success', async () => {
  let next = 0;
  await expect(readCompleteAvailabilityStaff(async () => ({ data: [{ id: id(++next) }], error: null }))).rejects.toThrow('read budget exhausted');
});
test('complete leap month includes every day and real zero-slot days', () => {
  const counts = readCompleteMonthAvailability(monthRows(), 2028, 2);
  expect(counts.size).toBe(29); expect(counts.get('2028-02-01')).toBe(0); expect(counts.get('2028-02-29')).toBe(28);
});
test.each([null, [], monthRows().slice(1), monthRows().concat([{ d: '2028-03-01', slots: 0 }]),
  monthRows().map((row, i) => i === 0 ? { ...row, slots: -1 } : row),
  monthRows().map((row, i) => i === 0 ? { ...row, slots: 0.5 } : row),
])('missing or invalid month result never becomes zero slots %#', raw => {
  expect(() => readCompleteMonthAvailability(raw, 2028, 2)).toThrow('month result incomplete');
});
test.each(['2028-03-01', '2028-02-29'])('wrong month or duplicate day is rejected: %s', d => {
  const rows = monthRows(); rows[0] = { d, slots: 0 };
  expect(() => readCompleteMonthAvailability(rows, 2028, 2)).toThrow('month date invalid');
});
test('valid fallback rows and explicit empty rows count correctly', () => {
  expect(countConfirmedAvailabilitySlots([{ slot_start: '09:00:00' }, { slot_start: '10:00' }])).toBe(2);
  expect(countConfirmedAvailabilitySlots([])).toBe(0);
});
test.each([null, {}, [{}], [{ slot_start: '25:00' }]])('unverified fallback result is rejected %#', raw => {
  expect(() => countConfirmedAvailabilitySlots(raw)).toThrow('fallback result invalid');
});
