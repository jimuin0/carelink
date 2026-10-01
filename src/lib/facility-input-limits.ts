// Intake and management edit the same persisted fields. Keep their upper
// bounds identical so accepted applications remain editable after onboarding.
export const FACILITY_INPUT_LIMITS = {
  name: 200,
  website: 2000,
  address: 500,
  city: 100,
  building: 200,
  nearestStation: 200,
  regularHoliday: 200,
} as const;
