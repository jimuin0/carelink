'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const Japan = dynamic(() => import('@react-map/japan'), { ssr: false });

const regions = [
  { name: '北海道', area: '北海道', prefectures: ['Hokkaido'], top: '3%', left: '68%' },
  { name: '東北', area: '青森県', prefectures: ['Aomori', 'Iwate', 'Miyagi', 'Akita', 'Yamagata', 'Fukushima'], top: '28%', left: '78%' },
  { name: '関東', area: '東京都', prefectures: ['Ibaraki', 'Tochigi', 'Gunma', 'Saitama', 'Chiba', 'Tokyo', 'Kanagawa'], top: '52%', left: '78%' },
  { name: '中部', area: '新潟県', prefectures: ['Niigata', 'Toyama', 'Ishikawa', 'Fukui', 'Yamanashi', 'Nagano', 'Gifu', 'Shizuoka', 'Aichi'], top: '35%', left: '2%' },
  { name: '近畿', area: '大阪府', prefectures: ['Mie', 'Shiga', 'Kyoto', 'Osaka', 'Hyogo', 'Nara', 'Wakayama'], top: '47%', left: '2%' },
  { name: '中国', area: '広島県', prefectures: ['Tottori', 'Shimane', 'Okayama', 'Hiroshima', 'Yamaguchi'], top: '57%', left: '2%' },
  { name: '四国', area: '徳島県', prefectures: ['Tokushima', 'Kagawa', 'Ehime', 'Kochi'], top: '67%', left: '2%' },
  { name: '九州・沖縄', area: '福岡県', prefectures: ['Fukuoka', 'Saga', 'Nagasaki', 'Kumamoto', 'Oita', 'Miyazaki', 'Kagoshima', 'Okinawa'], top: '78%', left: '2%' },
];

const prefToRegion = new Map<string, typeof regions[number]>();
regions.forEach((r) => r.prefectures.forEach((p) => prefToRegion.set(p, r)));

// 特殊文字を除去（@react-map/japan の Hokkaido\x8d 対策）
const normalize = (code: string) => code.replace(/[^\x20-\x7E]/g, '');

// 全pathを走査してfillを適用（特殊文字入りIDに対応）
function applyFill(container: HTMLElement, prefCodes: string[], color: string) {
  const paths = container.querySelectorAll('path[id]');
  paths.forEach((el) => {
    const clean = normalize(el.id.replace(/-.*$/, ''));
    if (prefCodes.includes(clean)) {
      (el as SVGPathElement).style.fill = color;
      (el as SVGPathElement).style.cursor = 'pointer';
    }
  });
}

export default function JapanRegionMap() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const listenersAttached = useRef(false);

  const setHovered = (name: string | null) => {
    hoveredRef.current = name;
    setHoveredRegion(name);
  };

  // 地図SVGのイベント登録（dynamic importで遅延ロードされるため、.map出現を待つ）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cleanup: (() => void) | null = null;

    const attachListeners = () => {
      if (listenersAttached.current) return true;
      const svgArea = container.querySelector('.map');
      if (!svgArea) return false;

      const findRegion = (target: EventTarget | null) => {
        const el = target as SVGPathElement;
        if (el?.tagName !== 'path' || !el.id) return null;
        const clean = normalize(el.id.replace(/-.*$/, ''));
        return prefToRegion.get(clean) || null;
      };

      const onMouseOver = (e: MouseEvent) => {
        const region = findRegion(e.target);
        if (region && hoveredRef.current !== region.name) {
          setHovered(region.name);
        }
      };

      const onMouseOut = (e: MouseEvent) => {
        const related = e.relatedTarget as Element | null;
        if (svgArea && related && svgArea.contains(related)) return;
        setHovered(null);
      };

      const onClick = (e: MouseEvent) => {
        const region = findRegion(e.target);
        if (region) {
          router.push(`/search?area=${encodeURIComponent(region.area)}`);
        }
      };

      svgArea.addEventListener('mouseover', onMouseOver as EventListener);
      svgArea.addEventListener('mouseout', onMouseOut as EventListener);
      svgArea.addEventListener('click', onClick as EventListener);
      listenersAttached.current = true;

      cleanup = () => {
        svgArea.removeEventListener('mouseover', onMouseOver as EventListener);
        svgArea.removeEventListener('mouseout', onMouseOut as EventListener);
        svgArea.removeEventListener('click', onClick as EventListener);
        listenersAttached.current = false;
      };
      return true;
    };

    if (!attachListeners()) {
      const interval = setInterval(() => {
        if (attachListeners()) clearInterval(interval);
      }, 200);
      const safety = setTimeout(() => clearInterval(interval), 10000);
      return () => {
        clearInterval(interval);
        clearTimeout(safety);
        cleanup?.();
      };
    }

    return () => cleanup?.();
  }, [router]);

  // hoveredRegion変化時に地図のfillを更新
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    regions.forEach((r) => {
      applyFill(container, r.prefectures, r.name === hoveredRegion ? '#fb923c' : '#f0f0f0');
    });
  }, [hoveredRegion]);

  return (
    <div ref={containerRef} className="relative">
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
            onMouseEnter={() => setHovered(region.name)}
            onMouseLeave={() => setHovered(null)}
          >
            {region.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
