/**
 * @jest-environment jsdom
 *
 * Modal（中央ダイアログ共通部品）の a11y/挙動テスト。
 * - open=false で何も描画しない
 * - open=true で role=dialog/aria-modal/children/footer を描画
 * - title 指定で aria-labelledby が見出しに関連付く
 * - ESC キー / 背景クリックで onClose
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from '@/components/Modal';

describe('Modal', () => {
  test('open=false → 何も描画しない', () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}}>内容</Modal>
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('open=true → role=dialog・aria-modal・children・footer を描画', () => {
    render(
      <Modal open onClose={() => {}} title="タイトル" footer={<button type="button">保存</button>}>
        <p>本文コンテンツ</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('本文コンテンツ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
  });

  test('title 指定 → aria-labelledby が見出し要素に一致', () => {
    render(<Modal open onClose={() => {}} title="編集">本文</Modal>);
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const heading = document.getElementById(labelledBy as string);
    expect(heading).toHaveTextContent('編集');
  });

  test('ESC キーで onClose が呼ばれる', () => {
    const onClose = jest.fn();
    render(<Modal open onClose={onClose}>本文</Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('背景（オーバーレイ）クリックで onClose が呼ばれる', () => {
    const onClose = jest.fn();
    render(<Modal open onClose={onClose}>本文</Modal>);
    // aria-hidden の背景オーバーレイを取得してクリック
    const overlay = document.querySelector('[aria-hidden="true"]');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
