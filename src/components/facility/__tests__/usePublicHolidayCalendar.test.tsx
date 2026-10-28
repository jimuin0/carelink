/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { usePublicHolidayCalendar } from '../usePublicHolidayCalendar';

function Reader({ enabled = true }: { enabled?: boolean }) {
  const calendar = usePublicHolidayCalendar(enabled);
  return <span>{calendar?.dates.has('2030-01-07') ? '祝日' : '未確認'}</span>;
}
test('複数カードで取得を共有し、失敗や期限切れは未確認に戻して再取得する', async () => {
  const original = global.fetch;
  let rejectFirst!: (error: Error) => void;
  global.fetch = jest.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
    .mockResolvedValueOnce({ok:true,json:async()=>({from:'2030-01-01',through:'2030-12-31',dates:['2030-01-07']})})
    .mockResolvedValueOnce({ok:true,json:async()=>({from:'2030-12-31',through:'2030-01-01',dates:[]})})
    .mockResolvedValueOnce({ok:false})
    .mockResolvedValueOnce({ok:true,json:async()=>({from:'2030-01-01',through:'2030-12-31',dates:['2030-01-07']})});
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  try {
    const view = render(<><Reader /><Reader /><Reader enabled={false} /></>);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    fireEvent.focus(window); // pending requests are coalesced
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { rejectFirst(new Error('offline')); });
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getAllByText('祝日')).toHaveLength(2));
    expect(screen.getByText('未確認')).toBeInTheDocument();
    fireEvent.focus(window); // a fresh successful result needs no refresh
    expect(global.fetch).toHaveBeenCalledTimes(2);
    now.mockReturnValue(1_000 + 30 * 60 * 1000);
    fireEvent.focus(window); // expired data is immediately withheld
    expect(screen.getAllByText('未確認')).toHaveLength(3);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    await act(async () => {});
    fireEvent.focus(window); // HTTP failure also remains unknown
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
    await act(async () => {});
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getAllByText('祝日')).toHaveLength(2));
    view.unmount();
  } finally { now.mockRestore(); global.fetch = original; }
});
