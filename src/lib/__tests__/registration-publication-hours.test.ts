import { canonicalRegistrationHours } from '../registration-publication-hours';

const week = { sun: null, mon: { open: '09:00', close: '17:00' }, tue: null, wed: null, thu: null, fri: null, sat: null };
test('a complete user-provided week is canonicalized without inventing hours', () => {
  expect(canonicalRegistrationHours({ ...week })).toEqual(week);
  expect(Object.keys(canonicalRegistrationHours({ ...week })!)).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
});
test('split and overnight periods retain all entered windows', () => {
  const split = { ...week, mon: { open: '09:00', close: '12:00', periods: [{ open: '09:00', close: '12:00' }, { open: '18:00', close: '01:00' }] } };
  expect(canonicalRegistrationHours(split)).toEqual(split);
});
test.each([null, {}, { ...week, mon: null }, { ...week, mon: { open: '09:00', close: '09:00' } }, { ...week, holiday: null }, { ...week, mon: { open: '23:00', close: '04:00' }, tue: { open: '03:00', close: '05:00' } }])(
  'incomplete, invalid, overlapping or unexpected days fail closed', input => {
    expect(canonicalRegistrationHours(input)).toBeNull();
  });

test('draft schema preserves incomplete entries and rejects unknown fields', () => {
  const { registrationHoursDraftSchema } = require('../registration-publication-hours');
  const incomplete = { mon: { open: '09:00', close: '' }, tue: null };
  expect(registrationHoursDraftSchema.parse(incomplete)).toEqual(incomplete);
  expect(registrationHoursDraftSchema.safeParse({ holiday: { open: '09:00', close: '10:00' } }).success).toBe(false);
  expect(registrationHoursDraftSchema.safeParse({ mon: { open: '09:00', close: '10:00', proof: 'private' } }).success).toBe(false);
});
