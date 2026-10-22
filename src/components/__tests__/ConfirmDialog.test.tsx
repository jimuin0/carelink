/**
 * @jest-environment jsdom
 *
 * ConfirmDialog（確認ダイアログ共通部品）の挙動テスト。
 * - open=false で何も描画しない
 * - open=true で role=dialog・タイトル・確定/キャンセルボタンを描画
 * - 確定/キャンセル/ESC/背景クリックのコールバック
 * - confirmDisabled=true で確定ボタンを無効化し、二重発火を防ぐ
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '@/components/ConfirmDialog';

function setup(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(
    <ConfirmDialog
      open
      title="削除しますか"
      message="この操作は取り消せません"
      confirmLabel="削除する"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  test('open=false → 何も描画しない', () => {
    const { container } = render(
      <ConfirmDialog open={false} title="t" message="m" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('open=true → role=dialog・タイトル・確定/キャンセルボタンを描画', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('削除しますか')).toBeInTheDocument();
    expect(screen.getByText('この操作は取り消せません')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '削除する' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
  });

  test('確定ボタンクリックで onConfirm', () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('キャンセル・背景クリック・ESC で onCancel', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  test('confirmDisabled=true → 確定ボタンが無効化され、クリックしても onConfirm が呼ばれない（二重発火防止）', () => {
    const { onConfirm } = setup({ confirmDisabled: true, confirmLabel: '削除中...' });
    const confirmBtn = screen.getByRole('button', { name: '削除中...' });
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('confirmDisabled 未指定（既定 false）→ 確定ボタンは有効', () => {
    setup();
    expect(screen.getByRole('button', { name: '削除する' })).toBeEnabled();
  });

  // 本文（取り消せない操作の前に伝える内容。例: キャンセル料）がダイアログの説明として結ばれていないと、
  // 開いたときにフォーカスがボタンへ移るだけで本文が読み上げられない。
  test('本文は aria-describedby でダイアログの説明として読み上げられる', () => {
    setup();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('この操作は取り消せません');
  });

  // 開いたあとで内容が変わったことは、開いた時点から置いてあるライブリージョンに書き込む。
  // 中身ごと差し込んだライブリージョンや本文の書き換えは読み上げられないことが多い。
  test('notice は開いた時点から在る role=status に入り、後から書き込める', () => {
    const props = { open: true, title: 't', message: 'm', onConfirm: () => {}, onCancel: () => {} };
    const { rerender } = render(<ConfirmDialog {...props} />);
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveClass('sr-only');
    rerender(<ConfirmDialog {...props} notice="キャンセル料の条件が変わりました。" />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('キャンセル料の条件が変わりました。');
    expect(region).not.toHaveClass('sr-only');
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('m キャンセル料の条件が変わりました。');
  });
});
