import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import JapanRegionMap from '../JapanRegionMap';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/components/BrowseLink', () => function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href}>{children}</a>;
});
jest.mock('next/dynamic', () => () => function Map() { return <svg className="map" data-testid="japan-svg" />; });

const originalObserver = global.IntersectionObserver;
afterEach(() => { global.IntersectionObserver = originalObserver; });

test('region links are available before the offscreen map code is loaded', () => {
  let notify: IntersectionObserverCallback;
  const observe = jest.fn();
  const disconnect = jest.fn();
  global.IntersectionObserver = jest.fn((callback: IntersectionObserverCallback) => {
    notify = callback;
    return { observe, disconnect };
  }) as unknown as typeof IntersectionObserver;
  const view = render(<JapanRegionMap />);
  expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  expect(screen.queryByTestId('japan-svg')).not.toBeInTheDocument();
  expect(observe).toHaveBeenCalledTimes(1);
  act(() => notify([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(screen.queryByTestId('japan-svg')).not.toBeInTheDocument();
  act(() => notify([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(screen.getByTestId('japan-svg')).toBeInTheDocument();
  expect(disconnect).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
});

test('browsers without IntersectionObserver still render the map and region links', async () => {
  global.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
  const view = render(<JapanRegionMap />);
  expect(await screen.findByTestId('japan-svg')).toBeInTheDocument();
  expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  view.unmount();
});
