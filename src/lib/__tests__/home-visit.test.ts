/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

import { HOME_VISIT_ONLY_FEATURE, isHomeVisitOnly } from '../home-visit';
import { facilityFeatures } from '../constants';

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

// 店舗が登録フォーム・設定画面で選べる選択肢（facilityFeatures）に無いと、
// 判定が true になる経路が DB 直接編集しか無くなる。
it('owners can choose the home-visit-only marker in the shared feature choices', () => {
  expect(facilityFeatures).toContain(HOME_VISIT_ONLY_FEATURE);
});
