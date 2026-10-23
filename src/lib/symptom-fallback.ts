import { getBusinessTypeName } from './seo-constants';
import { businessTypeLabel } from './business-type-label';

/**
 * 症状ページ・症状チェッカーで、対応施設が 0 件のときに案内する業種（2026年10月22日 新設）。
 *
 * 症状マスタは「鍼灸院・整骨院特化」の migration（20260404000001）で入った 30 症状だけで、
 * 全て鍼灸院・整骨院が扱う症状として作られている。業種ページ（/type/acupuncture）は
 * 公開施設を全国から並べ、都道府県別の一覧へも辿れるので、空ページの行き止まりを解消できる。
 *
 * ブラウザ側（症状チェッカー）からも読むため、DB に触れるモジュールとは分けて置く。
 */
export const SYMPTOM_FALLBACK_TYPE_SLUG = 'acupuncture';
/** 表示名（「鍼灸院・整骨院・整体」）。保存値ではない（business-type-label.ts）。 */
export const SYMPTOM_FALLBACK_TYPE_NAME = businessTypeLabel(getBusinessTypeName(SYMPTOM_FALLBACK_TYPE_SLUG)!);
export const SYMPTOM_FALLBACK_HREF = `/type/${SYMPTOM_FALLBACK_TYPE_SLUG}`;
