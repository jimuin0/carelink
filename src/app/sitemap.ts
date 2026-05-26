import type { MetadataRoute } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { allPrefectureSlugs, allBusinessTypeSlugs, getPrefectureSlug, getBusinessTypeSlug } from '@/lib/seo-constants';
import { getAllCitySlugs } from '@/data/city-slugs';
import { articles } from '@/data/articles';
import { SITE_URL } from '@/lib/constants';

// 完全動的: 環境変数変更/施設追加を即時反映、CDN静的化を完全回避
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const updated = new Date();

  // 業種別グローバルページ（/type/[typeSlug]）
  const businessTypeTopPages: MetadataRoute.Sitemap = allBusinessTypeSlugs.map((slug) => ({
    url: `${SITE_URL}/type/${slug}`,
    lastModified: updated,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: updated, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/search`, lastModified: updated, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/salon`, lastModified: updated, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/ranking`, lastModified: updated, changeFrequency: 'daily', priority: 0.7 },
    { url: `${SITE_URL}/blog`, lastModified: updated, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/recruit`, lastModified: updated, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/legal`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/compare`, lastModified: updated, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/register`, lastModified: updated, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/contact`, lastModified: updated, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/symptom-checker`, lastModified: updated, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/salon/demo`, lastModified: updated, changeFrequency: 'monthly', priority: 0.6 },
  ];

  // Prefecture pages (47 pages)
  const prefecturePages: MetadataRoute.Sitemap = allPrefectureSlugs.map((slug) => ({
    url: `${SITE_URL}/${slug}`,
    lastModified: updated,
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }));

  const supabase = createServerSupabaseClient();

  // Dynamic facility pages（prefecture, business_type も取得して 0件エリアを除外）
  const { data: facilities } = await supabase
    .from('facility_profiles')
    .select('slug, updated_at, prefecture, business_type, city')
    .eq('status', 'published');

  // 施設が存在するエリアの Set を構築（薄いコンテンツページをサイトマップから除外）
  // 注: crossPages 生成より前に宣言する（TDZ 回避 — Cannot access before initialization 防止）
  const occupiedPrefType = new Set<string>();
  const occupiedCityType = new Set<string>();
  for (const f of facilities || []) {
    const ps = getPrefectureSlug(f.prefecture);
    const ts = getBusinessTypeSlug(f.business_type);
    if (ps && ts) {
      occupiedPrefType.add(`${ps}/${ts}`);
      if (f.city) occupiedCityType.add(`${ps}/${f.city}/${ts}`);
    }
  }

  // Prefecture x BusinessType pages — 施設が1件以上あるページのみ掲載（薄いコンテンツ除外）
  const crossPages: MetadataRoute.Sitemap = allPrefectureSlugs.flatMap((ps) =>
    allBusinessTypeSlugs
      .filter((ts) => occupiedPrefType.has(`${ps}/${ts}`))
      .map((ts) => ({
        url: `${SITE_URL}/${ps}/${ts}`,
        lastModified: updated,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      }))
  );

  // Symptom pages
  const { data: symptoms } = await supabase.from('symptoms').select('slug');
  const symptomPages: MetadataRoute.Sitemap = (symptoms || []).map((s) => ({
    url: `${SITE_URL}/symptom/${s.slug}`,
    lastModified: updated,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  const facilityPages: MetadataRoute.Sitemap = (facilities || []).map((f) => ({
    url: `${SITE_URL}/facility/${f.slug}`,
    lastModified: f.updated_at ? new Date(f.updated_at) : updated,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  // Feature pages
  const { data: features } = await supabase
    .from('features')
    .select('slug, updated_at')
    .eq('is_published', true);

  const featurePages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/feature`, lastModified: updated, changeFrequency: 'weekly' as const, priority: 0.6 },
    ...(features || []).map((f) => ({
      url: `${SITE_URL}/feature/${f.slug}`,
      lastModified: f.updated_at ? new Date(f.updated_at) : updated,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];

  // City pages (283+ pages)
  const allCities = getAllCitySlugs();
  const cityPages: MetadataRoute.Sitemap = allCities.map((c) => ({
    url: `${SITE_URL}/${c.prefectureSlug}/${c.citySlug}`,
    lastModified: updated,
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));

  // City x BusinessType pages (top cities only)
  const majorPrefectures = ['tokyo', 'osaka', 'kanagawa', 'aichi', 'fukuoka', 'saitama', 'chiba', 'hyogo', 'kyoto', 'hokkaido'];
  const majorCities = allCities.filter((c) => majorPrefectures.includes(c.prefectureSlug));
  const cityTypePages: MetadataRoute.Sitemap = majorCities.flatMap((c) =>
    allBusinessTypeSlugs.map((ts) => ({
      url: `${SITE_URL}/${c.prefectureSlug}/${c.citySlug}/${ts}`,
      lastModified: updated,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    }))
  );

  // Blog articles (from static data)
  const blogPages: MetadataRoute.Sitemap = articles.map((a) => ({
    url: `${SITE_URL}/blog/${a.slug}`,
    lastModified: new Date(a.publishedAt),
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  // Jobs (公開施設に紐づくもののみ)
  const { data: jobs } = await supabase
    .from('facility_jobs')
    .select('id, updated_at, facility_profiles!inner(slug, status)')
    .eq('facility_profiles.status', 'published');
  const jobPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/jobs`, lastModified: updated, changeFrequency: 'daily' as const, priority: 0.7 },
    ...((jobs || []) as Array<{ id: string; updated_at: string | null }>).map((j) => ({
      url: `${SITE_URL}/jobs/${j.id}`,
      lastModified: j.updated_at ? new Date(j.updated_at) : updated,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
  return [...staticPages, ...businessTypeTopPages, ...prefecturePages, ...crossPages, ...cityPages, ...cityTypePages, ...facilityPages, ...featurePages, ...blogPages, ...symptomPages, ...jobPages];
}
