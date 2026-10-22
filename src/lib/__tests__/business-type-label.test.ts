import { BUSINESS_TYPE_DISPLAY_LABELS, businessTypeLabel } from '../business-type-label';
import { businessTypes } from '../constants';
import { getBusinessTypeName, getBusinessTypeSlug } from '../seo-constants';

describe('業種の表示名（保存値は変えない）', () => {
  it('「鍼灸院・整骨院」は「鍼灸院・整骨院・整体」と表示する（2026年10月23日 神原さん決定）', () => {
    expect(businessTypeLabel('鍼灸院・整骨院')).toBe('鍼灸院・整骨院・整体');
  });

  it.each(businessTypes.filter((t) => t !== '鍼灸院・整骨院'))('%s はそのまま表示する', (type) => {
    expect(businessTypeLabel(type)).toBe(type);
  });

  it('対応表に無い値は隠さずそのまま返す', () => {
    expect(businessTypeLabel('整体院')).toBe('整体院');
    // プロトタイプ上の名前を表示名と取り違えない
    expect(businessTypeLabel('toString')).toBe('toString');
  });

  it('空・null・undefined はそのまま返す（呼び出し側の既定値に任せる）', () => {
    expect(businessTypeLabel('')).toBe('');
    expect(businessTypeLabel(null)).toBeNull();
    expect(businessTypeLabel(undefined)).toBeUndefined();
  });

  it('保存値・スラッグ・URL の対応は変えていない（既存の行と外部リンクを壊さない）', () => {
    expect(businessTypes).toContain('鍼灸院・整骨院');
    expect(businessTypes).not.toContain('鍼灸院・整骨院・整体');
    expect(getBusinessTypeName('acupuncture')).toBe('鍼灸院・整骨院');
    expect(getBusinessTypeSlug('鍼灸院・整骨院')).toBe('acupuncture');
    // 表示名のキーはすべて実在する保存値（存在しない値に表示名を付けて空振りしない）
    for (const stored of Object.keys(BUSINESS_TYPE_DISPLAY_LABELS)) expect(businessTypes).toContain(stored);
  });
});
