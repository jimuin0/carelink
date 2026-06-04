// @ts-check
import base from './stryker.config.mjs';
const config = {
  ...base,
  jest: {
    ...base.jest,
  },
  mutate: [
    'src/lib/i18n.ts',
    'src/lib/seo-constants.ts',
    'src/lib/seo-snippets.ts',
    'src/lib/json-ld.ts',
  ],
  jsonReporter: { fileName: 'reports/mutation/agent1.json' },
};
export default config;
