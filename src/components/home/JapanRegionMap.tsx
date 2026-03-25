'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const regions = [
  {
    id: 'hokkaido-tohoku',
    name: '北海道・東北',
    area: '北海道',
    // Simplified path for Hokkaido + Tohoku region
    d: 'M180,15 L210,10 L230,25 L225,50 L210,55 L195,45 Z M175,60 L195,55 L205,65 L200,90 L185,100 L170,90 L165,75 Z',
    labelX: 195,
    labelY: 55,
  },
  {
    id: 'kanto',
    name: '関東',
    area: '東京都',
    d: 'M170,95 L190,90 L200,100 L195,120 L180,125 L165,115 Z',
    labelX: 182,
    labelY: 108,
  },
  {
    id: 'chubu',
    name: '中部',
    area: '新潟県',
    d: 'M135,70 L170,65 L175,90 L170,110 L150,115 L130,105 L125,85 Z',
    labelX: 150,
    labelY: 90,
  },
  {
    id: 'kinki',
    name: '近畿',
    area: '大阪府',
    d: 'M120,110 L150,105 L160,120 L155,140 L135,145 L115,135 Z',
    labelX: 137,
    labelY: 125,
  },
  {
    id: 'chugoku-shikoku',
    name: '中国・四国',
    area: '広島県',
    d: 'M60,110 L115,105 L120,125 L115,145 L100,155 L70,150 L50,135 L55,120 Z',
    labelX: 85,
    labelY: 130,
  },
  {
    id: 'kyushu-okinawa',
    name: '九州・沖縄',
    area: '福岡県',
    d: 'M30,130 L55,125 L60,145 L55,170 L40,180 L25,170 L20,150 Z M15,195 L30,190 L35,200 L25,210 L15,205 Z',
    labelX: 40,
    labelY: 158,
  },
];

export default function JapanRegionMap() {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="relative">
      <svg viewBox="0 0 250 220" className="w-full max-w-[400px] mx-auto" aria-label="日本地図エリア検索">
        {regions.map((region) => (
          <g key={region.id}>
            <path
              d={region.d}
              className={`cursor-pointer transition-all duration-200 ${
                hovered === region.id
                  ? 'fill-sky-400 stroke-sky-600'
                  : 'fill-sky-100 stroke-sky-300 hover:fill-sky-200'
              }`}
              strokeWidth={1.5}
              onClick={() => router.push(`/search?area=${encodeURIComponent(region.area)}`)}
              onMouseEnter={() => setHovered(region.id)}
              onMouseLeave={() => setHovered(null)}
            />
            <text
              x={region.labelX}
              y={region.labelY}
              textAnchor="middle"
              className={`text-[9px] font-medium pointer-events-none select-none ${
                hovered === region.id ? 'fill-white' : 'fill-sky-700'
              }`}
            >
              {region.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
