import type { MetadataRoute } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase-server';

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-ruddy-psi.vercel.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const updated = new Date();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: updated, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/search`, lastModified: updated, changeFrequency: 'daily', priority: 0.9 },
    { url: `${baseUrl}/salon`, lastModified: updated, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/recruit`, lastModified: updated, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/jobs`, lastModified: updated, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/privacy`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/contact`, lastModified: updated, changeFrequency: 'monthly', priority: 0.5 },
  ];

  // Dynamic facility pages
  const supabase = createServerSupabaseClient();
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

  return [...staticPages, ...facilityPages];
}
