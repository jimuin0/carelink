/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SpecialHoursEditor, { type SpecialHoursDraft } from '../SpecialHoursEditor';

function Editor() {
  const [value, setValue] = useState<SpecialHoursDraft>({ allowOvernightBookings: false, closeOnPublicHolidays: false, closedDates: [], receptionCutoffMinutes: null });
  return <SpecialHoursEditor value={value} onChange={setValue} />;
}

test('a facility can select holiday closures, dates and cutoff without changing defaults', () => {
  render(<Editor />);
  const holiday = screen.getByRole('checkbox', { name: '祝日・振替休日を休業にする' });
  expect(holiday).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: '日付をまたぐ予約を受け付ける' })).not.toBeChecked();
  expect(screen.getByLabelText('受付終了時刻')).toHaveValue('');
  fireEvent.click(holiday);
  fireEvent.change(screen.getByLabelText('臨時休業日'), { target: { value: '2026-12-31' } });
  fireEvent.click(screen.getByRole('button', { name: '休業日を追加' }));
  expect(screen.getByText('2026/12/31')).toBeVisible();
  fireEvent.change(screen.getByLabelText('受付終了時刻'), { target: { value: '15' } });
  expect(screen.getByLabelText('受付終了時刻')).toHaveValue('15');
  fireEvent.click(screen.getByRole('button', { name: '2026-12-31の臨時休業を削除' }));
  expect(screen.queryByText('2026/12/31')).not.toBeInTheDocument();
});

test('requires a date and does not add the same closure twice', () => {
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: '休業日を追加' }));
  expect(screen.getByRole('alert')).toHaveTextContent('日付を選択してください');
  fireEvent.change(screen.getByLabelText('臨時休業日'), { target: { value: '2026-12-31' } });
  fireEvent.click(screen.getByRole('button', { name: '休業日を追加' }));
  fireEvent.change(screen.getByLabelText('臨時休業日'), { target: { value: '2026-12-31' } });
  fireEvent.click(screen.getByRole('button', { name: '休業日を追加' }));
  expect(screen.getByRole('alert')).toHaveTextContent('この日付は追加済みです');
  expect(screen.getAllByText('2026/12/31')).toHaveLength(1);
});
