import type { Metadata } from 'next';
import Link from '@/components/BrowseLink';
import { MEDICAL_DIRECTORY_GROUPS, typeHref } from '@/lib/business-type-menu';

export const metadata: Metadata = {
  title: '病院・クリニック・歯科を探す',
  description: '病院・クリニック・歯科を診療科から探せます。内科・外科・小児科・皮膚科・歯科など。',
  alternates: { canonical: '/medical' },
};

/** 医療機関を診療科から探すページ（ヘッダーの「病院・クリニック・歯科」の行き先・2026年11月22日）。 */
export default function MedicalDirectoryPage() {
  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="jp-balance text-2xl font-bold mb-6">病院・クリニック・歯科を探す</h1>
        <div className="space-y-4">
          {MEDICAL_DIRECTORY_GROUPS.map((group) => (
            <section key={group.title} className="bg-white rounded-2xl shadow-xs p-4">
              <h2 className="text-sm font-bold text-gray-700 mb-3">{group.title}</h2>
              <ul className="flex flex-wrap gap-2">
                {group.types.map((type) => (
                  <li key={type}>
                    <Link href={typeHref(type)} className="inline-block rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:border-primary hover:text-primary transition-colors">
                      {type}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
