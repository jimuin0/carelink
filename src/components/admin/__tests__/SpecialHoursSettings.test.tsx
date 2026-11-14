/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpecialHoursSettings from '../SpecialHoursSettings';

const initial = { allowOvernightBookings: false, closeOnPublicHolidays: false, closedDates: [], receptionCutoffMinutes: null, revision: null };
const facility = 'faa10001-0000-4000-8000-000000000001';
let fetchMock: jest.Mock;
const reply = (data: unknown, ok = true) => ({ ok, json: async () => data });
beforeEach(() => { fetchMock = jest.fn(); global.fetch = fetchMock; });

test('loads the selected store, saves its own setting and confirms the saved revision', async () => {
  fetchMock.mockResolvedValueOnce(reply(initial));
  fetchMock.mockResolvedValueOnce(reply({ ok: true }));
  fetchMock.mockResolvedValueOnce(reply({ ...initial, closeOnPublicHolidays: true, revision: '2026-10-28T00:00:00Z' }));
  render(<SpecialHoursSettings facilityId={facility} />);
  fireEvent.click(await screen.findByRole('checkbox', { name: '祝日・振替休日を休業にする' }));
  fireEvent.click(screen.getByRole('button', { name: '祝日・臨時休業と受付終了を保存' }));
  expect(await screen.findByText('保存しました。')).toBeVisible();
  expect(fetchMock.mock.calls[1][0]).toBe(`/api/admin/special-hours?facility_id=${facility}`);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ...initial, closeOnPublicHolidays: true });
  expect(screen.getByRole('button', { name: '祝日・臨時休業と受付終了を保存' })).toBeDisabled();
});

test('a conflict preserves the unsaved input for review', async () => {
  fetchMock.mockResolvedValueOnce(reply(initial));
  fetchMock.mockResolvedValueOnce(reply({ error: '別の画面で設定が変更されています。' }, false));
  render(<SpecialHoursSettings facilityId={facility} />);
  const checkbox = await screen.findByRole('checkbox', { name: '祝日・振替休日を休業にする' });
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: '祝日・臨時休業と受付終了を保存' }));
  await waitFor(() => expect(screen.getByText('別の画面で設定が変更されています。')).toBeVisible());
  expect(checkbox).toBeChecked();
});

test('malformed saved settings never become an empty editable form', async () => {
  fetchMock.mockResolvedValueOnce(reply({ ok: true }));
  render(<SpecialHoursSettings facilityId={facility} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('設定を読み込めませんでした');
  expect(screen.queryByRole('checkbox', { name: '祝日・振替休日を休業にする' })).not.toBeInTheDocument();
});
