'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const Japan = dynamic(() => import('@react-map/japan'), { ssr: false });

const BASE_COLOR = '#E8D5B7';
const STROKE_COLOR = '#C5AC8E';
const HOVER_COLOR = '#F5A623';

const regions = [
  { name: '北海道', area: '北海道', prefectures: ['Hokkaido'], top: '8%', left: '70%' },
  { name: '東北', area: '青森県', prefectures: ['Aomori', 'Iwate', 'Miyagi', 'Akita', 'Yamagata', 'Fukushima'], top: '30%', left: '72%' },
  { name: '関東', area: '東京都', prefectures: ['Ibaraki', 'Tochigi', 'Gunma', 'Saitama', 'Chiba', 'Tokyo', 'Kanagawa'], top: '52%', left: '72%' },
  { name: '中部', area: '新潟県', prefectures: ['Niigata', 'Toyama', 'Ishikawa', 'Fukui', 'Yamanashi', 'Nagano', 'Gifu', 'Shizuoka', 'Aichi'], top: '38%', left: '38%' },
  { name: '近畿', area: '大阪府', prefectures: ['Mie', 'Shiga', 'Kyoto', 'Osaka', 'Hyogo', 'Nara', 'Wakayama'], top: '58%', left: '36%' },
  { name: '中国', area: '広島県', prefectures: ['Tottori', 'Shimane', 'Okayama', 'Hiroshima', 'Yamaguchi'], top: '50%', left: '10%' },
  { name: '四国', area: '徳島県', prefectures: ['Tokushima', 'Kagawa', 'Ehime', 'Kochi'], top: '68%', left: '30%' },
  { name: '九州・沖縄', area: '福岡県', prefectures: ['Fukuoka', 'Saga', 'Nagasaki', 'Kumamoto', 'Oita', 'Miyazaki', 'Kagoshima', 'Okinawa'], top: '72%', left: '4%' },
];

const prefToRegion = new Map<string, typeof regions[number]>();
regions.forEach((r) => r.prefectures.forEach((p) => prefToRegion.set(p, r)));

const normalize = (code: string) => code.replace(/[^\x20-\x7E]/g, '');

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    regions.forEach((r) => {
      applyFill(container, r.prefectures, r.name === hoveredRegion ? HOVER_COLOR : BASE_COLOR);
    });
  }, [hoveredRegion]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex justify-center">
        <Japan
          type="select-single"
          size={340}
          mapColor={BASE_COLOR}
          strokeColor={STROKE_COLOR}
          strokeWidth={0.8}
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
            className={`pointer-events-auto absolute inline-block px-2.5 py-1 rounded text-xs font-bold transition-colors ${
              hoveredRegion === region.name
                ? 'bg-orange-400 text-white shadow-md'
                : 'bg-white/90 text-amber-900 shadow-sm hover:bg-orange-400 hover:text-white hover:shadow-md'
            }`}
            style={{
              top: region.top,
              left: region.left,
              border: hoveredRegion === region.name ? '1px solid #F5A623' : '1px solid #D4B896',
            }}
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
