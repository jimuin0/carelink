// @ts-check
import base from './stryker.config.mjs';
const config = {
  ...base,
  jest: {
    ...base.jest,
  },
  mutate: [
    'src/lib/constants.ts',
    'src/lib/safe.ts',
    'src/lib/image-utils.ts',
    'src/lib/suspensions.ts',
  ],
  jsonReporter: { fileName: 'reports/mutation/agent2.json' },
};
export default config;
