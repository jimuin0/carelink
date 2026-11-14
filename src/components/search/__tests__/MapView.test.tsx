/**
 * @jest-environment jsdom
 *
 * 監査 A274: leaflet の読み込み中に facilities が変わると、cleanup 時点ではまだ地図が無く何も外せず、
 * 古い読み込みが後から同じ div に L.map を作り、新しい読み込みの L.map が
 * 'Map container is already initialized' で落ちていた。古い読み込みは地図を作らない。
 */
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import MapView from '../MapView';
import type { FacilityCardData } from '@/types';

const mockMap = jest.fn();
jest.mock('leaflet', () => {
  const chain = () => {
    const m: Record<string, unknown> = {};
    m.setView = () => m; m.addTo = () => m; m.bindPopup = () => m; m.fitBounds = () => m; m.remove = jest.fn();
    return m;
  };
  return {
    __esModule: true,
    default: {
      map: (...args: unknown[]) => { mockMap(...args); return chain(); },
      tileLayer: () => chain(),
      marker: () => chain(),
      latLngBounds: () => ({}),
      Icon: { Default: { mergeOptions: () => {} } },
    },
  };
});

const facility = (id: string) => ({ id, slug: id, name: id, prefecture: '大阪府', city: '豊中市', latitude: 34.7, longitude: 135.4 }) as unknown as FacilityCardData;

test('読み込み中に一覧が変わっても、地図は最新の読み込みの 1 回だけ作る', async () => {
  const { rerender, container } = render(<MapView facilities={[facility('a')]} />);
  rerender(<MapView facilities={[facility('b')]} />);
  await waitFor(() => expect(mockMap).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 10));
  expect(mockMap).toHaveBeenCalledTimes(1);
  expect(container.querySelector('div[style*="display: block"]')).toBeInTheDocument();
});
