import { specialBusinessIntervalFits, specialBusinessWindows, specialReceptionStatus, specialReceptionWindows, type SpecialBusinessHours } from '../special-business-hours';
import { WEEK_DAYS } from '../business-hours';

const closed = Object.fromEntries(WEEK_DAYS.map(day => [day, null]));
const week = { ...closed, mon: { open: '09:00', close: '18:00' }, tue: { open: '18:00', close: '05:00' } };
const settings: SpecialBusinessHours = { dates: {}, closeOnPublicHolidays: false };

test('no setting preserves the existing weekly schedule', () => {
  expect(specialBusinessWindows(week, '2026-10-26', null, null)).toEqual([{ start: 540, end: 1080 }]);
  expect(specialBusinessWindows(week, '2026-10-28', null, null)).toEqual([{ start: 0, end: 300 }]);
});

test('a facility-specific closure takes precedence over a previous overnight opening', () => {
  const original = JSON.stringify(week);
  expect(specialBusinessWindows(week, '2026-10-28', { ...settings, dates: { '2026-10-28': null } }, null)).toEqual([]);
  expect(specialBusinessWindows(week, '2026-10-28', settings, null)).toEqual([{ start: 0, end: 300 }]);
  expect(JSON.stringify(week)).toBe(original);
});

test('holiday closure is opt-in and unknown holiday calendars do not claim hours', () => {
  const holiday = { from: '2026-01-01', through: '2026-12-31', dates: new Set(['2026-10-26']) };
  expect(specialBusinessWindows(week, '2026-10-26', settings, holiday)).toEqual([{ start: 540, end: 1080 }]);
  expect(specialBusinessWindows(week, '2026-10-26', { ...settings, closeOnPublicHolidays: true }, holiday)).toEqual([]);
  expect(specialBusinessWindows(week, '2026-10-26', { ...settings, closeOnPublicHolidays: true }, null)).toBeNull();
  expect(specialBusinessWindows(week, '2026-10-26', { ...settings, closeOnPublicHolidays: true, dates: { '2026-10-26': null } }, null)).toEqual([]);
});

test('a date beyond the holiday calendar coverage remains unknown', () => {
  const calendar = { from: '2026-01-01', through: '2026-12-31', dates: new Set<string>() };
  expect(specialBusinessWindows(week, '2027-01-04', { ...settings, closeOnPublicHolidays: true }, calendar)).toBeNull();
  expect(specialBusinessWindows(week, '2026-01-01', { ...settings, closeOnPublicHolidays: true }, calendar)).toBeNull();
});

test('special hours replace the chosen day and malformed input fails closed', () => {
  const special = { ...settings, dates: { '2026-10-26': { open: '10:00', close: '12:00' } } };
  expect(specialBusinessWindows(week, '2026-10-26', special, null)).toEqual([{ start: 600, end: 720 }]);
  expect(specialBusinessWindows(week, '2026-02-30', settings, null)).toBeNull();
  expect(specialBusinessWindows({}, '2026-10-26', settings, null)).toBeNull();
  expect(specialBusinessWindows(week, '2026-10-26', { ...settings, dates: { '2026-10-26': { open: 'bad', close: '12:00' } } }, null)).toBeNull();
});

test('reception cutoff follows a special closure at midnight', () => {
  const closure = { ...settings, dates: { '2026-10-28': null } };
  expect(specialReceptionWindows(week, '2026-10-27', closure, null, 15))
    .toEqual([{ start: 1080, end: 1425 }]);
  expect(specialReceptionWindows(week, '2026-10-28', closure, null, 15)).toEqual([]);
});

test('reception accounts for the real overnight closing time', () => {
  expect(specialReceptionWindows(week, '2026-10-27', settings, null, 15))
    .toEqual([{ start: 1080, end: 1440 }]);
  expect(specialReceptionWindows(week, '2026-10-28', settings, null, 15))
    .toEqual([{ start: 0, end: 285 }]);
});

test('continuous opening does not receive an artificial midnight deadline', () => {
  const allDay = Object.fromEntries(WEEK_DAYS.map(day => [day, { open: '00:00', close: '24:00' }]));
  expect(specialReceptionWindows(allDay, '2026-10-28', settings, null, 15)).toEqual([{ start: 0, end: 1440 }]);
  expect(specialReceptionWindows(allDay, '2026-10-28', { ...settings, closeOnPublicHolidays: true }, null, 15)).toBeNull();
});

test('an overnight appointment is rejected if the next day is a special closure', () => {
  const closure = { ...settings, dates: { '2026-10-28': null } };
  expect(specialBusinessIntervalFits(week, '2026-10-27', 1410, 1470, settings, null)).toBe(true);
  expect(specialBusinessIntervalFits(week, '2026-10-27', 1410, 1470, closure, null)).toBe(false);
});

test('overnight interval does not assume unknown holiday information', () => {
  expect(specialBusinessIntervalFits(week, '2026-10-27', 1410, 1470,
    { ...settings, closeOnPublicHolidays: true }, null)).toBeNull();
});

test('JST status changes at the reception cutoff and at closing', () => {
  expect(specialReceptionStatus(week, settings, null, 15, Date.parse('2026-10-26T08:44:00Z'))).toBe('open');
  expect(specialReceptionStatus(week, settings, null, 15, Date.parse('2026-10-26T08:45:00Z'))).toBe('reception_closed');
  expect(specialReceptionStatus(week, settings, null, 15, Date.parse('2026-10-26T09:00:00Z'))).toBe('closed');
  expect(specialReceptionStatus(week, settings, null, null, Date.parse('2026-10-26T08:59:00Z'))).toBe('open');
  expect(specialReceptionStatus(week, settings, null, 15, NaN)).toBe('unknown');
  expect(specialReceptionStatus(week, { ...settings, closeOnPublicHolidays: true }, null, 15, Date.parse('2026-10-26T08:45:00Z'))).toBe('unknown');
});
