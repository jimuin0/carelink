import { render } from '@testing-library/react';
import Spinner from '../Spinner';

describe('Spinner', () => {
  test('SVGがレンダリングされる', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  test('デフォルトクラスが適用される', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    const cls = svg?.getAttribute('class') || '';
    expect(cls).toContain('animate-spin');
    expect(cls).toContain('w-5');
    expect(cls).toContain('h-5');
  });

  test('カスタムクラスが適用される', () => {
    const { container } = render(<Spinner className="w-10 h-10" />);
    const svg = container.querySelector('svg');
    const cls = svg?.getAttribute('class') || '';
    expect(cls).toContain('animate-spin');
    expect(cls).toContain('w-10');
    expect(cls).toContain('h-10');
  });
});
