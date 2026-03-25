'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';

const Japan = dynamic(() => import('@react-map/japan'), { ssr: false });

const regions: { name: string; area: string; prefectures: string[] }[] = [
  { name: '北海道・東北', area: '北海道', prefectures: ['Hokkaido', 'Aomori', 'Iwate', 'Miyagi', 'Akita', 'Yamagata', 'Fukushima'] },
  { name: '関東', area: '東京都', prefectures: ['Ibaraki', 'Tochigi', 'Gunma', 'Saitama', 'Chiba', 'Tokyo', 'Kanagawa'] },
  { name: '中部', area: '新潟県', prefectures: ['Niigata', 'Toyama', 'Ishikawa', 'Fukui', 'Yamanashi', 'Nagano', 'Gifu', 'Shizuoka', 'Aichi'] },
  { name: '近畿', area: '大阪府', prefectures: ['Mie', 'Shiga', 'Kyoto', 'Osaka', 'Hyogo', 'Nara', 'Wakayama'] },
  { name: '中国・四国', area: '広島県', prefectures: ['Tottori', 'Shimane', 'Okayama', 'Hiroshima', 'Yamaguchi', 'Tokushima', 'Kagawa', 'Ehime', 'Kochi'] },
  { name: '九州・沖縄', area: '福岡県', prefectures: ['Fukuoka', 'Saga', 'Nagasaki', 'Kumamoto', 'Oita', 'Miyazaki', 'Kagoshima', 'Okinawa'] },
];

const prefToRegion = new Map<string, typeof regions[number]>();
regions.forEach((r) => r.prefectures.forEach((p) => prefToRegion.set(p, r)));

const normalize = (code: string) => code.replace(/[^\x20-\x7E]/g, '');

function getPathEl(container: HTMLElement, prefCode: string): SVGPathElement | null {
  // パッケージはid="{PrefCode}-{instanceId}"形式
  return container.querySelector(`path[id^="${prefCode}-"]`);
}

export default function JapanRegionMap() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const hoveredRegionRef = useRef<string | null>(null);

  const highlightRegion = useCallback((regionName: string | null, color: string) => {
    const container = containerRef.current;
    if (!container) return;
    const region = regions.find((r) => r.name === regionName);
    if (!region) return;
    region.prefectures.forEach((pref) => {
      const el = getPathEl(container, pref);
      if (el) el.style.fill = color;
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as SVGPathElement;
      if (target.tagName === 'path' && target.id) {
        const raw = target.id.replace(/-.*$/, '');
        const clean = normalize(raw);
        const region = prefToRegion.get(clean);
        if (region) {
          // 同じ地域なら再描画しない
          if (hoveredRegionRef.current === region.name) {
            const rect = container.getBoundingClientRect();
            setTooltip({ text: region.name, x: e.clientX - rect.left, y: e.clientY - rect.top });
            return;
          }
          // 前の地域をリセット
          if (hoveredRegionRef.current) {
            highlightRegion(hoveredRegionRef.current, '#f0f0f0');
          }
          hoveredRegionRef.current = region.name;
          highlightRegion(region.name, '#38bdf8');
          const rect = container.getBoundingClientRect();
          setTooltip({ text: region.name, x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
      }
    };

    const handleMouseLeave = () => {
      if (hoveredRegionRef.current) {
        highlightRegion(hoveredRegionRef.current, '#f0f0f0');
        hoveredRegionRef.current = null;
      }
      setTooltip(null);
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as SVGPathElement;
      if (target.tagName === 'path' && target.id) {
        const raw = target.id.replace(/-.*$/, '');
        const clean = normalize(raw);
        const region = prefToRegion.get(clean);
        if (region) {
          router.push(`/search?area=${encodeURIComponent(region.area)}`);
        }
      }
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);
    container.addEventListener('click', handleClick);
    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
      container.removeEventListener('click', handleClick);
    };
  }, [highlightRegion, router]);

  return (
    <div ref={containerRef} className="relative flex justify-center">
      <Japan
        type="select-single"
        size={380}
        mapColor="#f0f0f0"
        strokeColor="#999999"
        strokeWidth={0.8}
        hoverColor="#f0f0f0"
        hints={false}
        disableClick
        disableHover
        onSelect={() => {}}
      />
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-white border border-gray-300 rounded-md px-3 py-2 text-sm font-bold text-gray-800 shadow-md z-10"
          style={{ left: tooltip.x + 16, top: tooltip.y - 10 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
