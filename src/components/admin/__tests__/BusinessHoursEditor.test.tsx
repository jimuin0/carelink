/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import BusinessHoursEditor from '../BusinessHoursEditor';
import { initialHoursForm } from '@/lib/business-hours-form';

function Editor() {
  const initial = initialHoursForm({ mon: { open: '18:00', close: '05:00' }, tue: null });
  const [hours, setHours] = useState(initial.hours);
  const [closed, setClosed] = useState(initial.closedDays);
  return <BusinessHoursEditor hours={hours} closedDays={closed}
    onDayChange={(day, value) => setHours(prev => ({ ...prev, [day]: value }))}
    onToggleClosed={day => setClosed(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])} />;
}

test('edits split periods and overnight hours without losing native input events', () => {
  render(<Editor />);
  const mon = screen.getByRole('group', { name: '月曜日' });
  expect(within(mon).getByText('翌日')).toBeVisible();
  const opening = within(mon).getByLabelText('月曜日の開店時間') as HTMLInputElement;
  opening.value = '09:00'; fireEvent.input(opening); fireEvent.blur(opening);
  fireEvent.change(within(mon).getByLabelText('月曜日の閉店時間'), { target: { value: '12:30' } });
  fireEvent.click(within(mon).getByRole('button', { name: '時間帯を追加' }));
  fireEvent.change(within(mon).getByLabelText('月曜日の2枠目の開店時間'), { target: { value: '15:00' } });
  fireEvent.change(within(mon).getByLabelText('月曜日の2枠目の閉店時間'), { target: { value: '18:20' } });
  expect(within(mon).getByLabelText('月曜日の開店時間')).toHaveValue('09:00');
  fireEvent.click(within(mon).getByRole('button', { name: '月曜日の時間帯2を削除' }));
  expect(within(mon).queryByLabelText('月曜日の2枠目の閉店時間')).not.toBeInTheDocument();
  fireEvent.click(within(mon).getByRole('button', { name: '24時間営業にする' }));
  expect(within(mon).getByLabelText('月曜日の閉店時間')).toHaveValue('24:00');
  fireEvent.click(within(mon).getByLabelText('月曜日に営業する'));
  expect(within(mon).queryByLabelText('月曜日の開店時間')).not.toBeInTheDocument();
  fireEvent.click(within(mon).getByLabelText('月曜日に営業する'));
  expect(within(mon).getByLabelText('月曜日の閉店時間')).toHaveValue('24:00');
});
