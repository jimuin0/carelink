import { renderHook } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { useFooterNavigation } from '../useFooterNavigation';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

beforeEach(() => mockPush.mockClear());

function fixture(href: string | null = '/search?area=Osaka#results') {
  const footer = document.createElement('footer');
  const anchor = document.createElement('a');
  if (href !== null) anchor.setAttribute('href', href);
  const child = document.createElement('span');
  anchor.append(child);
  footer.append(anchor);
  const event = {
    currentTarget: footer, target: child, defaultPrevented: false, button: 0,
    metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    preventDefault: jest.fn(),
  };
  const { result } = renderHook(() => useFooterNavigation());
  return { footer, anchor, child, event, click: () => result.current(event as unknown as MouseEvent<HTMLElement>) };
}

test('nested link clicks use one router navigation with query and fragment intact', () => {
  const f = fixture();
  f.click();
  expect(f.event.preventDefault).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/search?area=Osaka#results');
});

test.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const)('%s keeps browser new-tab/window behavior', (key) => {
  const f = fixture();
  f.event[key] = true;
  f.click();
  expect(f.event.preventDefault).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

test.each([1, 2])('mouse button %s keeps native behavior', (button) => {
  const f = fixture(); f.event.button = button; f.click();
  expect(mockPush).not.toHaveBeenCalled();
  expect(f.event.preventDefault).not.toHaveBeenCalled();
});

test('child handlers can prevent navigation', () => {
  const f = fixture(); f.event.defaultPrevented = true; f.click();
  expect(mockPush).not.toHaveBeenCalled();
});

test('non-element and non-anchor clicks are ignored', () => {
  const f = fixture();
  f.event.target = document.createTextNode('text') as unknown as HTMLSpanElement; f.click();
  f.event.target = document.createElement('button'); f.footer.append(f.event.target); f.click();
  expect(mockPush).not.toHaveBeenCalled();
});

test('portal anchors outside the footer are ignored', () => {
  const f = fixture(); f.anchor.remove(); f.click();
  expect(mockPush).not.toHaveBeenCalled();
});

test.each([null, '', '#section', 'https://example.org/external', 'mailto:test@example.org', 'javascript:void(0)'])('%s retains native behavior', (href) => {
  const f = fixture(href); f.click();
  expect(mockPush).not.toHaveBeenCalled();
  expect(f.event.preventDefault).not.toHaveBeenCalled();
});

test('download links are not intercepted, including empty download attributes', () => {
  const f = fixture('/download'); f.anchor.setAttribute('download', ''); f.click();
  expect(mockPush).not.toHaveBeenCalled();
});

test.each(['_blank', 'named-frame'])('%s targets are not intercepted', (target) => {
  const f = fixture(); f.anchor.target = target; f.click();
  expect(mockPush).not.toHaveBeenCalled();
});

test.each(['_self', '_SELF'])('%s stays in the current router', (target) => {
  const f = fixture('/privacy'); f.anchor.target = target; f.click();
  expect(mockPush).toHaveBeenCalledWith('/privacy');
});
