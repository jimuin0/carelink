'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';

const Japan = dynamic(() => import('@react-map/japan'), { ssr: false });

const regions = [
  { name: '北海道', area: '北海道', prefectures: ['Hokkaido'], top: '3%', left: '68%' },
  { name: '東北', area: '青森県', prefectures: ['Aomori', 'Iwate', 'Miyagi', 'Akita', 'Yamagata', 'Fukushima'], top: '28%', left: '78%' },
  { name: '関東', area: '東京都', prefectures: ['Ibaraki', 'Tochigi', 'Gunma', 'Saitama', 'Chiba', 'Tokyo', 'Kanagawa'], top: '52%', left: '78%' },
  { name: '中部', area: '新潟県', prefectures: ['Niigata', 'Toyama', 'Ishikawa', 'Fukui', 'Yamanashi', 'Nagano', 'Gifu', 'Shizuoka', 'Aichi'], top: '38%', left: '2%' },
  { name: '近畿', area: '大阪府', prefectures: ['Mie', 'Shiga', 'Kyoto', 'Osaka', 'Hyogo', 'Nara', 'Wakayama'], top: '62%', left: '2%' },
  { name: '中国', area: '広島県', prefectures: ['Tottori', 'Shimane', 'Okayama', 'Hiroshima', 'Yamaguchi'], top: '52%', left: '2%' },
  { name: '四国', area: '徳島県', prefectures: ['Tokushima', 'Kagawa', 'Ehime', 'Kochi'], top: '76%', left: '2%' },
  { name: '九州・沖縄', area: '福岡県', prefectures: ['Fukuoka', 'Saga', 'Nagasaki', 'Kumamoto', 'Oita', 'Miyazaki', 'Kagoshima', 'Okinawa'], top: '72%', left: '2%' },
];

const prefToRegion = new Map<string, typeof regions[number]>();
regions.forEach((r) => r.prefectures.forEach((p) => prefToRegion.set(p, r)));

const normalize = (code: string) => code.replace(/[^\x20-\x7E]/g, '');

function getAllPaths(container: HTMLElement, prefCodes: string[]): SVGPathElement[] {
  const paths: SVGPathElement[] = [];
  prefCodes.forEach((code) => {
    const el = container.querySelector(`path[id^="${code}-"]`) as SVGPathElement | null;
    if (el) paths.push(el);
  });
  return paths;
}

export default function JapanRegionMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);

  const highlightRegion = useCallback((regionName: string | null, highlight: boolean) => {
    const container = containerRef.current;
    if (!container) return;
    const region = regions.find((r) => r.name === regionName);
    if (!region) return;
    const paths = getAllPaths(container, region.prefectures);
    paths.forEach((el) => {
      el.style.fill = highlight ? '#fb923c' : '#f0f0f0';
    });
  }, []);

  // 地図上のhover
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as SVGPathElement;
      if (target.tagName === 'path' && target.id) {
        const raw = target.id.replace(/-.*$/, '');
        const clean = normalize(raw);
        const region = prefToRegion.get(clean);
        if (region && hoveredRegion !== region.name) {
          setHoveredRegion(region.name);
        }
      }
    };

    const handleMouseLeave = () => setHoveredRegion(null);

    const svgArea = container.querySelector('.map');
    if (svgArea) {
      svgArea.addEventListener('mouseover', handleMouseOver as EventListener);
      svgArea.addEventListener('mouseleave', handleMouseLeave);
      return () => {
        svgArea.removeEventListener('mouseover', handleMouseOver as EventListener);
        svgArea.removeEventListener('mouseleave', handleMouseLeave);
      };
    }
  }, [hoveredRegion]);

  // ハイライト同期
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // 全リセット
    regions.forEach((r) => {
      const paths = getAllPaths(container, r.prefectures);
      paths.forEach((el) => { el.style.fill = '#f0f0f0'; });
    });
    // ホバー中の地域をハイライト
    if (hoveredRegion) {
      highlightRegion(hoveredRegion, true);
    }
  }, [hoveredRegion, highlightRegion]);

  // ラベルのhover→地図連動
  const handleLabelEnter = (name: string) => setHoveredRegion(name);
  const handleLabelLeave = () => setHoveredRegion(null);

  return (
    <div ref={containerRef} className="relative">
      {/* 地図 */}
      <div className="flex justify-center">
        <Japan
          type="select-single"
          size={320}
          mapColor="#f0f0f0"
          strokeColor="#bbbbbb"
          strokeWidth={0.6}
          hints={false}
          disableClick
          disableHover
          onSelect={() => {}}
        />
      </div>

      {/* HPB風の地域ラベル（地図の周囲に配置） */}
      <div className="absolute inset-0 pointer-events-none">
        {regions.map((region) => (
          <Link
            key={region.name}
            href={`/search?area=${encodeURIComponent(region.area)}`}
            className={`pointer-events-auto absolute inline-block px-2 py-0.5 rounded text-xs font-bold border transition-colors ${
              hoveredRegion === region.name
                ? 'bg-orange-400 text-white border-orange-400'
                : 'bg-white text-sky-700 border-sky-300 hover:bg-orange-400 hover:text-white hover:border-orange-400'
            }`}
            style={{ top: region.top, left: region.left }}
            onMouseEnter={() => handleLabelEnter(region.name)}
            onMouseLeave={handleLabelLeave}
          >
            {region.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
