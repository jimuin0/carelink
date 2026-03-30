import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { getFacilityBySlug } from '@/lib/facilities';
import { getStaffBySlug, getStaffPhotos } from '@/lib/staff';

export const revalidate = 3600;

interface Props {
  params: { slug: string; staffSlug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) return {};
  const staff = await getStaffBySlug(facility.id, params.staffSlug);
  if (!staff) return {};
  return {
    title: `${staff.name} | ${facility.name} | CareLink`,
    description: `${facility.name}の${staff.position || 'スタッフ'}${staff.name}のプロフィール。${staff.specialties?.length > 0 ? '得意分野: ' + staff.specialties.join('・') : ''}`,
    alternates: { canonical: `/facility/${params.slug}/staff/${params.staffSlug}` },
  };
}

export default async function StaffDetailPage({ params }: Props) {
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) notFound();

  const staff = await getStaffBySlug(facility.id, params.staffSlug);
  if (!staff) notFound();

  const photos = await getStaffPhotos(staff.id);
  const portfolioPhotos = photos.filter((p) => p.photo_type === 'portfolio');
  const beforeAfterPhotos = photos.filter((p) => p.photo_type === 'before_after');

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white shadow-sm">
        <nav className="px-4 sm:px-6 pt-3 pb-1" aria-label="パンくずリスト">
          <ol className="flex items-center gap-1.5 text-xs text-gray-400">
            <li><Link href="/search" className="hover:text-sky-600">トップ</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href={`/facility/${params.slug}`} className="hover:text-sky-600">{facility.name}</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href={`/facility/${params.slug}/staff`} className="hover:text-sky-600">スタッフ</Link></li>
            <li><span className="mx-1">/</span></li>
            <li className="text-gray-600 font-medium">{staff.name}</li>
          </ol>
        </nav>

        <div className="px-4 sm:px-6 py-6">
          {/* Profile header */}
          <div className="flex gap-4 sm:gap-6 mb-8">
            <div className="relative w-24 h-24 sm:w-32 sm:h-32 rounded-full overflow-hidden bg-gray-100 shrink-0">
              {staff.photo_url ? (
                <Image src={staff.photo_url} alt={staff.name} fill className="object-cover" />
              ) : (
                <div className="flex items-center justify-center h-full bg-gradient-to-br from-sky-50 to-sky-100">
                  <svg className="w-12 h-12 text-sky-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              )}
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">{staff.name}</h1>
              {staff.position && <p className="text-sm text-gray-500 mt-1">{staff.position}</p>}
              {staff.years_experience && (
                <p className="text-sm text-gray-500">経験{staff.years_experience}年</p>
              )}
              {staff.instagram_url && /^https?:\/\//i.test(staff.instagram_url) && (
                <a
                  href={staff.instagram_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-pink-500 hover:underline mt-2"
                >
                  Instagram
                </a>
              )}
            </div>
          </div>

          {/* Specialties */}
          {staff.specialties?.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                <span className="w-1 h-5 bg-sky-500 rounded-full" />
                得意分野
              </h2>
              <div className="flex flex-wrap gap-2">
                {staff.specialties?.map((s) => (
                  <span key={s} className="text-xs bg-sky-50 text-sky-700 px-3 py-1.5 rounded-full font-medium">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Bio */}
          {staff.bio && (
            <div className="mb-6">
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                <span className="w-1 h-5 bg-sky-500 rounded-full" />
                自己紹介
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">{staff.bio}</p>
            </div>
          )}

          {/* Portfolio */}
          {portfolioPhotos.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                <span className="w-1 h-5 bg-amber-400 rounded-full" />
                作品集
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {portfolioPhotos.map((photo) => (
                  <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                    <Image src={photo.photo_url} alt={photo.caption || '作品'} fill className="object-cover" />
                    {photo.caption && (
                      <p className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-2 truncate">
                        {photo.caption}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Before/After */}
          {beforeAfterPhotos.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                <span className="w-1 h-5 bg-pink-400 rounded-full" />
                ビフォーアフター
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {beforeAfterPhotos.map((photo) => (
                  <div key={photo.id} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-gray-100">
                    <Image src={photo.photo_url} alt={photo.caption || 'ビフォーアフター'} fill className="object-cover" />
                    {photo.caption && (
                      <p className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-2 truncate">
                        {photo.caption}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
