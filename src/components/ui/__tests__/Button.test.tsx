/**
 * @jest-environment jsdom
 *
 * 共通ボタン（src/components/ui/Button.tsx）の描画契約。
 * 見た目の値（色・角丸・高さ）を画面側に散らさないための部品なので、
 * 「どの variant / size でどのトークンが付くか」と「要素の出し分け」を固定する。
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

const linkProps: Array<Record<string, unknown>> = [];
jest.mock('next/link', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: ({ prefetch, href, children, ...rest }: { prefetch?: unknown; href: string; children?: React.ReactNode }) => {
      linkProps.push({ prefetch, href });
      return React.createElement('a', { href, 'data-next-link': '', ...rest }, children);
    },
  };
});

import Button, { buttonClassName } from '../Button';

beforeEach(() => {
  linkProps.length = 0;
});

describe('Button（<button> として描く）', () => {
  it('既定は primary / md / type="button"', () => {
    render(<Button>予約する</Button>);
    const button = screen.getByRole('button', { name: '予約する' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('bg-(--primary)', 'text-white', 'min-h-11', 'rounded-control');
  });

  it('type="submit" を明示すればフォーム送信ボタンになる', () => {
    const onSubmit = jest.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">送信</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['primary', ['bg-(--primary)', 'text-white', 'hover:bg-(--primary-dark)']],
    ['secondary', ['border-(--primary)', 'text-(--primary)', 'bg-white']],
    ['ghost', ['border-gray-300', 'text-gray-700', 'hover:bg-gray-100']],
    ['danger', ['bg-red-700', 'text-white', 'hover:bg-red-800']],
  ] as const)('variant=%s の配色', (variant, classes) => {
    render(<Button variant={variant}>操作</Button>);
    expect(screen.getByRole('button', { name: '操作' })).toHaveClass(...classes);
  });

  it.each([
    ['sm', 'min-h-9'],
    ['md', 'min-h-11'],
    ['lg', 'min-h-13'],
  ] as const)('size=%s の高さ', (size, cls) => {
    render(<Button size={size}>操作</Button>);
    expect(screen.getByRole('button', { name: '操作' })).toHaveClass(cls);
  });

  it('無効時は押せず、無効の配色と not-allowed カーソルを持つ', () => {
    const onClick = jest.fn();
    render(<Button disabled onClick={onClick}>送信</Button>);
    const button = screen.getByRole('button', { name: '送信' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveClass('disabled:bg-gray-300', 'disabled:text-gray-600', 'disabled:cursor-not-allowed');
  });

  it('フォーカス枠は --primary で描く（既定の sky-500 枠は白地 2.77:1 で足りない）', () => {
    render(<Button>操作</Button>);
    expect(screen.getByRole('button', { name: '操作' })).toHaveClass('focus-visible:outline-(--primary)');
  });

  it('fullWidth と className（配置）を足せる。aria-* と data-* はそのまま渡る', () => {
    render(
      <Button fullWidth className="mt-3" aria-label="フィルターをクリア" data-testid="clear">
        クリア
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'フィルターをクリア' });
    expect(button).toHaveClass('w-full', 'mt-3');
    expect(button).toHaveAttribute('data-testid', 'clear');
  });
});

describe('Button（href でリンクとして描く）', () => {
  it('内部リンクは BrowseLink を通し、既定で先読みしない', () => {
    render(<Button href="/search">サロンを探す</Button>);
    const link = screen.getByRole('link', { name: 'サロンを探す' });
    expect(link).toHaveAttribute('href', '/search');
    expect(link).toHaveAttribute('data-next-link');
    expect(link).toHaveClass('rounded-control', 'min-h-11');
    expect(linkProps).toEqual([{ prefetch: false, href: '/search' }]);
  });

  it('prefetch を明示すればそちらが勝つ（高意図の導線）', () => {
    render(<Button href="/auth/signup" prefetch="auto">登録</Button>);
    expect(linkProps).toEqual([{ prefetch: 'auto', href: '/auth/signup' }]);
  });

  it.each(['tel:0312345678', 'mailto:info@example.com', 'https://example.com', 'data:text/calendar;charset=utf-8,BEGIN', '#contact'])(
    '%s はルーターを通さず素の <a> で描く',
    (href) => {
      render(<Button href={href}>開く</Button>);
      const link = screen.getByRole('link', { name: '開く' });
      expect(link).toHaveAttribute('href', href);
      expect(link).not.toHaveAttribute('data-next-link');
      expect(linkProps).toEqual([]);
    },
  );

  it('リンクには type 属性を付けない', () => {
    render(<Button href="/">トップ</Button>);
    expect(screen.getByRole('link', { name: 'トップ' })).not.toHaveAttribute('type');
  });
});

describe('buttonClassName', () => {
  it('Button と同じクラスを返す', () => {
    render(<Button variant="secondary" size="lg">操作</Button>);
    expect(screen.getByRole('button', { name: '操作' }).className).toBe(buttonClassName({ variant: 'secondary', size: 'lg' }));
  });

  it('角丸は rounded-control だけを使う（他の角丸トークンを混ぜない）', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      for (const size of ['sm', 'md', 'lg'] as const) {
        const cls = buttonClassName({ variant, size });
        expect(cls).toContain('rounded-control');
        expect(cls).not.toMatch(/(^|\s)rounded-(?!control)/);
      }
    }
  });
});
