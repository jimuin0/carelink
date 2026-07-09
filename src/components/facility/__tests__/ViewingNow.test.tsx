/**
 * @jest-environment jsdom
 *
 * ViewingNow（「N人が閲覧中」演出）の回帰テスト。
 * 【hydration mismatch 回帰防止】ランダム要素(Math.random)を描画中に評価すると SSR とクライアントで
 * 値が食い違い hydration が失敗する。マウント後(useEffect)にのみ確定し、初期描画は何も出さない設計を固定する。
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import ViewingNow from '@/components/facility/ViewingNow';

describe('ViewingNow', () => {
  test('マウント後に「N人が閲覧中」を表示する（値は viewCount/100 + 1〜3）', async () => {
    render(<ViewingNow viewCount={500} />);
    // マウント後（useEffect）にバッジが出る
    await waitFor(() => expect(screen.getByText(/人が閲覧中/)).toBeInTheDocument());
    const text = screen.getByText(/人が閲覧中/).textContent || '';
    const m = text.match(/(\d+)人が閲覧中/);
    expect(m).not.toBeNull();
    const viewers = Number(m![1]);
    // floor(500/100)=5 に randomOffset(1〜3) を加算 → 6〜8
    expect(viewers).toBeGreaterThanOrEqual(6);
    expect(viewers).toBeLessThanOrEqual(8);
  });

  test('viewCount=0 でも最低1人以上を表示（Math.max(1,...)）', async () => {
    render(<ViewingNow viewCount={0} />);
    await waitFor(() => expect(screen.getByText(/人が閲覧中/)).toBeInTheDocument());
    const viewers = Number((screen.getByText(/人が閲覧中/).textContent || '').match(/(\d+)/)![1]);
    expect(viewers).toBeGreaterThanOrEqual(1);
  });
});
