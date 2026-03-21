import type { MetadataRoute } from 'next';

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink.jp';

export default function sitemap(): MetadataRoute.Sitemap {
  const updated = new Date('2026-03-21');
  return [
    { url: baseUrl, lastModified: updated, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/salon`, lastModified: updated, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/recruit`, lastModified: updated, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/jobs`, lastModified: updated, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/privacy`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/contact`, lastModified: updated, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
