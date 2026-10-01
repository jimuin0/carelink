import { hasConfirmedBookingHours } from '../booking-preparation';
const valid = { mon: { open: '10:00', close: '18:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
test('complete explicitly saved hours allow booking; holidays remain closed', () => {
  expect(hasConfirmedBookingHours(valid)).toBe(true);
});
test.each([null, undefined, false, '', [], {}, { ...valid, mon: null }, { ...valid, mon: '10-18' },
  { ...valid, mon: [] }, { ...valid, mon: { open: 10, close: '18:00' } },
  { ...valid, mon: { open: '10:00', close: 18 } }, { ...valid, mon: { open: '24:00', close: '25:00' } },
  { ...valid, mon: { open: '10:00', close: '18:60' } }, { ...valid, mon: { open: '18:00', close: '10:00' } },
  { ...valid, mon: { open: '10:00', close: '10:00' } }, { mon: valid.mon },
])('malformed, incomplete or all-closed hours are not confirmed %#', value => {
  expect(hasConfirmedBookingHours(value)).toBe(false);
});
