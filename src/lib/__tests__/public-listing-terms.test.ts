/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LISTING_FEES_NOTICE } from '../public-listing-terms';

test('support fee wording exactly matches the current legal statement without changing the consent fingerprint', () => {
  const terms = readFileSync(join(process.cwd(), 'src/app/terms/page.tsx'), 'utf8');
  const feeParagraph = terms.match(/<li>(掲載料・予約手数料[^<]+)<\/li>/)?.[1];
  expect(feeParagraph).toBeDefined();
  expect(LISTING_FEES_NOTICE).toBe(feeParagraph);
});
