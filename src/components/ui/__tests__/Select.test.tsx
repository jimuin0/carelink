/**
 * @jest-environment jsdom
 *
 * 共通セレクト（src/components/ui/Select.tsx）の描画契約。
 */
import '@testing-library/jest-dom';
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Select from '../Select';

function renderSelect(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  const onChange = jest.fn();
  render(
    <Select aria-label="業種を選択" value="" onChange={onChange} {...props}>
      <option value="">すべて</option>
      <option value="hair">ヘア</option>
    </Select>,
  );
  return { select: screen.getByRole('combobox', { name: '業種を選択' }), onChange };
}

it('ブラウザ既定の描画を外し、高さ 44px・角丸 12px・16px の文字で揃える（iOS のズーム防止）', () => {
  const { select } = renderSelect();
  expect(select).toHaveClass('appearance-none', 'min-h-11', 'rounded-control', 'text-base');
});

it('size="sm" は 36px', () => {
  const { select } = renderSelect({ size: 'sm' });
  expect(select).toHaveClass('min-h-9');
  expect(select).not.toHaveClass('min-h-11');
});

it('矢印は装飾として読み上げず、クリックを素通しする', () => {
  const { select } = renderSelect();
  const chevron = select.parentElement!.querySelector('[data-select-chevron]');
  expect(chevron).toHaveAttribute('aria-hidden', 'true');
  expect(chevron).toHaveClass('pointer-events-none');
});

it('選択の変更が onChange に届く', () => {
  const { select, onChange } = renderSelect();
  fireEvent.change(select, { target: { value: 'hair' } });
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('ref は <select> に渡る（react-hook-form の register 用）', () => {
  const ref = createRef<HTMLSelectElement>();
  render(
    <Select ref={ref} aria-label="時間帯" defaultValue="">
      <option value="">指定なし</option>
    </Select>,
  );
  expect(ref.current).toBe(screen.getByRole('combobox', { name: '時間帯' }));
});

it('className は select に、wrapperClassName は外側の箱に付く', () => {
  const { select } = renderSelect({ className: 'font-bold', wrapperClassName: 'mb-5' });
  expect(select).toHaveClass('font-bold');
  expect(select.parentElement).toHaveClass('relative', 'mb-5');
});

it('無効・エラー時の配色を持つ', () => {
  const { select } = renderSelect({ disabled: true, 'aria-invalid': true });
  expect(select).toBeDisabled();
  expect(select).toHaveClass('disabled:bg-gray-100', 'disabled:text-gray-600', 'aria-invalid:border-red-700');
});
