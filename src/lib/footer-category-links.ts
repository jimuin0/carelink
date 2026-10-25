import { regionGroups, businessTypes } from '@/lib/constants';
import { getPrefectureSlug, getBusinessTypeSlug } from '@/lib/seo-constants';
import { businessTypeLabel } from '@/lib/business-type-label';

const ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ENTITIES[char]);

/** Fixed public taxonomy only. No request, session, facility or user data. */
export function renderFooterCategoryLinks(types: readonly string[], prefectures: readonly string[]): string {
  return types.map((type) => {
    const typeSlug = getBusinessTypeSlug(type);
    const links = prefectures.map((prefecture) => {
      const prefectureSlug = getPrefectureSlug(prefecture);
      const href = prefectureSlug && typeSlug
        ? `/${prefectureSlug}/${typeSlug}`
        : `/search?type=${encodeURIComponent(type)}&area=${encodeURIComponent(prefecture)}`;
      return `<a href="${escapeHtml(href)}">${escapeHtml(prefecture)}</a>`;
    }).join('');
    const headingHref = `/search?type=${encodeURIComponent(type)}`;
    return `<div><h3 class="text-xs font-bold mb-1.5"><a href="${escapeHtml(headingHref)}" class="text-gray-300 hover:text-white transition-colors">${escapeHtml(businessTypeLabel(type))}</a></h3><div class="footer-category-areas">${links}</div></div>`;
  }).join('');
}

// Shared immutable markup avoids building and walking ~1,900 React link nodes
// on every SSR request. Delegated footer navigation handles the real anchors.
export const FOOTER_CATEGORY_LINKS_HTML = renderFooterCategoryLinks(
  businessTypes, regionGroups.flatMap((region) => region.prefectures),
);
