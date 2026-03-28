import type { MetadataRoute } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { allPrefectureSlugs, allBusinessTypeSlugs } from '@/lib/seo-constants';
import { getAllCitySlugs } from '@/data/city-slugs';
import { articles } from '@/data/articles';

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.carelink-jp.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const updated = new Date();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: updated, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/search`, lastModified: updated, changeFrequency: 'daily', priority: 0.9 },
    { url: `${baseUrl}/salon`, lastModified: updated, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/ranking`, lastModified: updated, changeFrequency: 'daily', priority: 0.7 },
    { url: `${baseUrl}/blog`, lastModified: updated, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${baseUrl}/jobs`, lastModified: updated, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${baseUrl}/recruit`, lastModified: updated, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${baseUrl}/privacy`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/contact`, lastModified: updated, changeFrequency: 'monthly', priority: 0.5 },
  ];

  // Prefecture pages (47 pages)
  const prefecturePages: MetadataRoute.Sitemap = allPrefectureSlugs.map((slug) => ({
    url: `${baseUrl}/${slug}`,
    lastModified: updated,
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }));

  // Prefecture x BusinessType pages (47 x 8 = 376 pages)
  const crossPages: MetadataRoute.Sitemap = allPrefectureSlugs.flatMap((ps) =>
    allBusinessTypeSlugs.map((ts) => ({
      url: `${baseUrl}/${ps}/${ts}`,
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

  const facilityPages: MetadataRoute.Sitemap = (facilities || []).map((f) => ({
    url: `${baseUrl}/facility/${f.slug}`,
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
    { url: `${baseUrl}/feature`, lastModified: updated, changeFrequency: 'weekly' as const, priority: 0.6 },
    ...(features || []).map((f) => ({
      url: `${baseUrl}/feature/${f.slug}`,
      lastModified: f.updated_at ? new Date(f.updated_at) : updated,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];

  // City pages (283+ pages)
  const allCities = getAllCitySlugs();
  const cityPages: MetadataRoute.Sitemap = allCities.map((c) => ({
    url: `${baseUrl}/${c.prefectureSlug}/${c.citySlug}`,
    lastModified: updated,
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));

  // City x BusinessType pages (top cities only)
  const majorPrefectures = ['tokyo', 'osaka', 'kanagawa', 'aichi', 'fukuoka', 'saitama', 'chiba', 'hyogo', 'kyoto', 'hokkaido'];
  const majorCities = allCities.filter((c) => majorPrefectures.includes(c.prefectureSlug));
  const cityTypePages: MetadataRoute.Sitemap = majorCities.flatMap((c) =>
    allBusinessTypeSlugs.map((ts) => ({
      url: `${baseUrl}/${c.prefectureSlug}/${c.citySlug}/${ts}`,
      lastModified: updated,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    }))
  );

  // Blog articles (from static data)
  const blogPages: MetadataRoute.Sitemap = articles.map((a) => ({
    url: `${baseUrl}/blog/${a.slug}`,
    lastModified: new Date(a.publishedAt),
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  return [...staticPages, ...prefecturePages, ...crossPages, ...cityPages, ...cityTypePages, ...facilityPages, ...featurePages, ...blogPages];
}
