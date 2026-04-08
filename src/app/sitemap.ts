import type { MetadataRoute } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { allPrefectureSlugs, allBusinessTypeSlugs } from '@/lib/seo-constants';
import { getAllCitySlugs } from '@/data/city-slugs';
import { articles } from '@/data/articles';
import { SITE_URL } from '@/lib/constants';

// 完全動的: 環境変数変更/施設追加を即時反映、CDN静的化を完全回避
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const updated = new Date();

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

  // Prefecture x BusinessType pages (47 x 8 = 376 pages)
  const crossPages: MetadataRoute.Sitemap = allPrefectureSlugs.flatMap((ps) =>
    allBusinessTypeSlugs.map((ts) => ({
      url: `${SITE_URL}/${ps}/${ts}`,
      lastModified: updated,
      changeFrequency: 'daily' as const,
      priority: 0.7,
    }))
  );

  const supabase = createServerSupabaseClient();

  // Dynamic facility pages
  const { data: facilities } = await supabase
    .from('facility_profiles')
    .select('slug, updated_at')
    .eq('status', 'published');

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
  const publishedFacilityIds = new Set((facilities || []).map((f: { slug: string }) => f.slug));
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
  // 抑止: 未使用変数を回避
  void publishedFacilityIds;

  return [...staticPages, ...prefecturePages, ...crossPages, ...cityPages, ...cityTypePages, ...facilityPages, ...featurePages, ...blogPages, ...symptomPages, ...jobPages];
}
