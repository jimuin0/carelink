/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

import { isHomeVisitOnly } from '../home-visit';

describe('isHomeVisitOnly', () => {
  it('is true only when features contains 訪問専門', () => {
    expect(isHomeVisitOnly(['訪問専門', '保険適用'])).toBe(true);
    expect(isHomeVisitOnly(['訪問対応可'])).toBe(false);
    expect(isHomeVisitOnly([])).toBe(false);
  });

  it('treats a missing or malformed features value as not home-visit-only', () => {
    expect(isHomeVisitOnly(null)).toBe(false);
    expect(isHomeVisitOnly(undefined)).toBe(false);
    expect(isHomeVisitOnly('訪問専門')).toBe(false);
  });
});
