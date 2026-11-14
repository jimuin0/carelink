/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import MedicalSpecialtyPicker from '@/components/register/MedicalSpecialtyPicker';

function Example() {
  const [value, setValue] = useState<string[]>([]);
  return <><MedicalSpecialtyPicker value={value} onChange={setValue} /><output>{value.join('・')}</output></>;
}

test('診療科を複数選び、個別に解除できる', () => {
  render(<Example />);
  fireEvent.click(screen.getByRole('checkbox', { name: '耳鼻咽喉科' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '内科' }));
  expect(screen.getByRole('status')).toHaveTextContent('内科・耳鼻咽喉科');
  fireEvent.click(screen.getByRole('checkbox', { name: '内科' }));
  expect(screen.getByRole('status')).toHaveTextContent('耳鼻咽喉科');
  expect(screen.getByRole('checkbox', { name: '耳鼻咽喉科' })).toBeChecked();
});
