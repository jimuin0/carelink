'use client';

import { useState, useEffect, useRef } from 'react';
import type { FacilityCardData } from '@/types';

interface Props {
  facilities: FacilityCardData[];
}

export default function MapView({ facilities }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const loadMap = async () => {
      const L = (await import('leaflet')).default;

      // Load Leaflet CSS
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      // Fix default icon paths
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const validFacilities = facilities.filter((f) => f.latitude != null && f.longitude != null);

      // Default center: Tokyo
      let center: [number, number] = [35.6812, 139.7671];
      if (validFacilities.length > 0) {
        const avgLat = validFacilities.reduce((s, f) => s + f.latitude!, 0) / validFacilities.length;
        const avgLng = validFacilities.reduce((s, f) => s + f.longitude!, 0) / validFacilities.length;
        center = [avgLat, avgLng];
      }

      const map = L.map(mapRef.current!, { scrollWheelZoom: true }).setView(center, 13);
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      for (const f of validFacilities) {
        const marker = L.marker([f.latitude!, f.longitude!]).addTo(map);
        const price = f.min_price ? `¥${f.min_price.toLocaleString()}〜` : '';
        const rating = f.rating_avg ? `★${f.rating_avg}` : '';
        marker.bindPopup(
          `<div style="min-width:180px">` +
          `<a href="/facility/${f.slug}" style="font-weight:bold;color:#0ea5e9;text-decoration:none">${f.name}</a>` +
          `<div style="font-size:12px;color:#666;margin-top:4px">${f.prefecture || ''}${f.city || ''}</div>` +
          `<div style="font-size:12px;margin-top:2px">${rating} ${price}</div>` +
          `</div>`
        );
      }

      if (validFacilities.length > 1) {
        const bounds = L.latLngBounds(validFacilities.map((f) => [f.latitude!, f.longitude!] as [number, number]));
        map.fitBounds(bounds, { padding: [40, 40] });
      }

      setMapReady(true);
    };

    loadMap().catch(() => {});

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [facilities]);

  const validCount = facilities.filter((f) => f.latitude != null && f.longitude != null).length;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div ref={mapRef} style={{ height: '500px', width: '100%' }} />
      {!mapReady && (
        <div className="flex items-center justify-center h-[500px] bg-gray-100">
          <p className="text-gray-400 text-sm">地図を読み込み中...</p>
        </div>
      )}
      {mapReady && validCount === 0 && (
        <div className="p-4 text-center text-gray-400 text-sm">
          位置情報のある施設がありません
        </div>
      )}
    </div>
  );
}
