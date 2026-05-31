// @ts-check
import base from './stryker.config.mjs';
const config = {
  ...base,
  jest: {
    ...base.jest,
  },
  mutate: [
    'src/lib/jobs.ts',
    'src/lib/validations.ts',
    'src/lib/validations-booking.ts',
    'src/lib/validations-auth.ts',
  ],
  jsonReporter: { fileName: 'reports/mutation/agent3.json' },
};
export default config;
