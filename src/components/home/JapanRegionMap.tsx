'use client';

// 地方リンクは 6 本が一度に viewport へ入る一覧。既定で先読みしない
// （理由と実測は components/BrowseLink.tsx）。
import Link from '@/components/BrowseLink';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { JAPAN_MAP_SIZE, MAP_REGIONS, regionSearchHref, type MapRegion } from '@/lib/japan-map-regions';

const Japan = dynamic(() => import('@react-map/japan'), { ssr: false });

const BASE_COLOR = '#E8D5B7';
const STROKE_COLOR = '#C5AC8E';
const HOVER_COLOR = '#F5A623';

// 地方の分け方・ラベル位置・リンク先は src/lib/japan-map-regions.ts（分け方の正は regionGroups）。
const regions = MAP_REGIONS;

const prefToRegion = new Map<string, MapRegion>();
regions.forEach((r) => r.mapCodes.forEach((p) => prefToRegion.set(p, r)));

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
  const [loadMap, setLoadMap] = useState(false);
  const hoveredRef = useRef<string | null>(null);
  const listenersAttached = useRef(false);

  const setHovered = (name: string | null) => {
    hoveredRef.current = name;
    setHoveredRegion(name);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof IntersectionObserver === 'undefined') {
      const timer = setTimeout(() => setLoadMap(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setLoadMap(true); observer.disconnect(); }
    }, { rootMargin: '250px' });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !loadMap) return;

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
          router.push(regionSearchHref(region));
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
  }, [router, loadMap]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    regions.forEach((r) => {
      applyFill(container, r.mapCodes, r.name === hoveredRegion ? HOVER_COLOR : BASE_COLOR);
    });
  }, [hoveredRegion]);

  return (
    // ラベルは地図上の px 座標で置くので、外枠を地図と同じ大きさに固定する（幅が変わるとずれる）。
    <div ref={containerRef} className="relative mx-auto" style={{ width: JAPAN_MAP_SIZE.width, height: JAPAN_MAP_SIZE.height }}>
      <div className="flex justify-center">
        {loadMap && <Japan
          type="select-single"
          size={JAPAN_MAP_SIZE.width}
          mapColor={BASE_COLOR}
          strokeColor={STROKE_COLOR}
          strokeWidth={0.8}
          hints={false}
          disableClick
          disableHover
          onSelect={() => {}}
        />}
      </div>

      <div className="absolute inset-0 pointer-events-none">
        {regions.map((region) => (
          <Link
            key={region.name}
            href={regionSearchHref(region)}
            className={`pointer-events-auto absolute inline-block px-2.5 py-1 rounded text-xs font-bold transition-colors ${
              hoveredRegion === region.name
                ? 'bg-orange-400 text-gray-900 shadow-md'
                : 'bg-white/90 text-amber-900 shadow-xs hover:bg-orange-400 hover:text-gray-900 hover:shadow-md'
            }`}
            style={{
              top: region.top,
              left: region.left,
              whiteSpace: 'nowrap',
              border: hoveredRegion === region.name ? '1px solid #F5A623' : '1px solid #D4B896',
            }}
            onMouseEnter={() => setHovered(region.name)}
            onMouseLeave={() => setHovered(null)}
          >
            {/* 白文字はオレンジ（orange-400）の上で 2.3:1 しかないので、強調時も濃い文字にする（gray-900 で 7.7:1） */}
            {region.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
