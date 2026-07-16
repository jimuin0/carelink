import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getFacilityBySlug } from '@/lib/facilities';
import { getStaffByFacility } from '@/lib/staff';
import StaffList from '@/components/facility/StaffList';

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) return {};
  // ルート layout の title.template '%s | CareLink' が自動付与するため、
  // metadata.title には「| CareLink」を付けない（付けると二重化する）。openGraph.title はテンプレ非適用のため付与する。
  const title = `スタッフ一覧 | ${facility.name}`;
  const description = `${facility.name}のスタッフ紹介。経歴・得意分野・作品集をご覧いただけます。`;
  return {
    title,
    description,
    alternates: { canonical: `/facility/${params.slug}/staff` },
    openGraph: { title: `${title} | CareLink`, description },
  };
}

export default async function StaffPage(props: Props) {
  const params = await props.params;
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) notFound();

  const staff = await getStaffByFacility(facility.id);

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white shadow-sm">
        <nav className="px-4 sm:px-6 pt-3 pb-1" aria-label="パンくずリスト">
          <ol className="flex items-center gap-1.5 text-xs text-gray-400">
            <li><Link href="/search" className="hover:text-sky-600">トップ</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href={`/facility/${params.slug}`} className="hover:text-sky-600">{facility.name}</Link></li>
            <li><span className="mx-1">/</span></li>
            <li className="text-gray-600 font-medium">スタッフ</li>
          </ol>
        </nav>

        <div className="px-4 sm:px-6 py-6">
          <h1 className="text-xl font-bold mb-6">スタッフ一覧</h1>
          <StaffList staff={staff} facilitySlug={params.slug} />
        </div>
      </div>
    </div>
  );
}
