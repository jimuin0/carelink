import Link from 'next/link';
import { businessTypes, regionGroups } from '@/lib/constants';
import HomeSearchForm from '@/components/search/HomeSearchForm';

const regionShortNames = ['関東', '関西', '中部', '北海道・東北', '中国・四国', '九州・沖縄'];

export default function Home() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Search */}
      <div className="py-5 border-b border-gray-200">
        <h1 className="text-lg font-bold">全国のサロン・クリニック検索・予約</h1>
        <HomeSearchForm />
      </div>

      {/* Business Types with Region Links */}
      <div className="py-4">
        {businessTypes.map((type) => (
          <div key={type} className="py-3 border-b border-gray-100 last:border-b-0">
            <div className="flex items-baseline gap-2">
              <span className="w-1 h-5 bg-primary rounded-sm flex-shrink-0 self-center" />
              <Link
                href={`/search?type=${encodeURIComponent(type)}`}
                className="text-primary font-bold text-[15px] hover:underline"
              >
                {type}を探す
              </Link>
            </div>
            <div className="flex flex-wrap items-center ml-3 mt-1 text-[13px]">
              {regionShortNames.map((region, i) => (
                <span key={region}>
                  {i > 0 && <span className="text-gray-300 mx-0.5">|</span>}
                  <Link
                    href={`/search?type=${encodeURIComponent(type)}&area=${encodeURIComponent(regionGroups.find(r => r.name === region)?.prefectures[0] || '')}`}
                    className="text-gray-500 hover:text-primary hover:underline"
                  >
                    {region}
                  </Link>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Area Search */}
      <div className="py-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1 h-5 bg-primary rounded-sm" />
          <h2 className="font-bold text-[15px]">エリアから探す</h2>
        </div>
        <table className="w-full text-[13px] border-collapse border border-gray-200">
          <tbody>
            {regionGroups.map((region) => (
              <tr key={region.name} className="border-b border-gray-200">
                <th className="bg-gray-50 px-3 py-2 text-left font-bold text-gray-700 w-28 sm:w-36 border-r border-gray-200 align-top whitespace-nowrap">
                  {region.name}
                </th>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {region.prefectures.map((pref) => (
                      <Link
                        key={pref}
                        href={`/search?area=${encodeURIComponent(pref)}`}
                        className="text-gray-500 hover:text-primary hover:underline"
                      >
                        {pref}
                      </Link>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
