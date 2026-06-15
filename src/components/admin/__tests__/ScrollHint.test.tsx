/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import ScrollHint from '@/components/admin/ScrollHint';

function setMetrics(el: HTMLElement, scrollLeft: number, clientWidth: number, scrollWidth: number) {
  Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
}

describe('ScrollHint', () => {
  it('children を描画し overflow-x-auto コンテナを持つ', () => {
    const { container } = render(
      <ScrollHint>
        <div data-testid="content">中身</div>
      </ScrollHint>
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(container.querySelector('.overflow-x-auto')).toBeInTheDocument();
  });

  it('右に余地がある時は右フェードのみ表示（左端では左フェードなし）', () => {
    const { container } = render(<ScrollHint><div>x</div></ScrollHint>);
    const scroller = container.querySelector('.overflow-x-auto') as HTMLElement;
    setMetrics(scroller, 0, 100, 300);
    fireEvent.scroll(scroller);
    expect(container.querySelector('.bg-gradient-to-l')).toBeInTheDocument(); // 右フェード
    expect(container.querySelector('.bg-gradient-to-r')).toBeNull(); // 左フェードなし
  });

  it('左右ともに余地がある時は両方のフェードを表示', () => {
    const { container } = render(<ScrollHint><div>x</div></ScrollHint>);
    const scroller = container.querySelector('.overflow-x-auto') as HTMLElement;
    setMetrics(scroller, 50, 100, 300);
    fireEvent.scroll(scroller);
    expect(container.querySelector('.bg-gradient-to-r')).toBeInTheDocument(); // 左フェード
    expect(container.querySelector('.bg-gradient-to-l')).toBeInTheDocument(); // 右フェード
  });

  it('端まで到達（余地なし）ならフェードを出さない', () => {
    const { container } = render(<ScrollHint><div>x</div></ScrollHint>);
    const scroller = container.querySelector('.overflow-x-auto') as HTMLElement;
    setMetrics(scroller, 0, 300, 300);
    fireEvent.scroll(scroller);
    expect(container.querySelector('.bg-gradient-to-r')).toBeNull();
    expect(container.querySelector('.bg-gradient-to-l')).toBeNull();
  });
});
