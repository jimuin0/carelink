'use client';

import Link from 'next/link';

const regions = [
  { name: '北海道・東北', area: '北海道', emoji: '🏔' },
  { name: '関東', area: '東京都', emoji: '🏙' },
  { name: '中部', area: '新潟県', emoji: '⛰' },
  { name: '近畿', area: '大阪府', emoji: '🏯' },
  { name: '中国・四国', area: '広島県', emoji: '🌊' },
  { name: '九州・沖縄', area: '福岡県', emoji: '🌴' },
];

export default function JapanRegionMap() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {regions.map((region) => (
        <Link
          key={region.name}
          href={`/search?area=${encodeURIComponent(region.area)}`}
          className="flex items-center gap-2.5 px-4 py-3 bg-white border border-gray-200 rounded-lg hover:bg-sky-50 hover:border-sky-200 transition-colors group"
        >
          <span className="text-lg">{region.emoji}</span>
          <span className="text-xs font-medium text-gray-700 group-hover:text-sky-700">{region.name}</span>
        </Link>
      ))}
    </div>
  );
}
