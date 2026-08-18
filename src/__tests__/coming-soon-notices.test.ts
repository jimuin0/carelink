/**
 * 「近日公開」表示が【出ていること】と【1 箇所に閉じていること】を固定する。
 *
 * 🔴 なぜ必要か
 * Issue #408（オンライン前払い）と #409（キャンセル待ち）はどちらも 2026年7月5日に
 * 「機能は完成させない。フロントには近日公開的な表示のみ出す」と決まっていたのに、
 * その表示だけが 1 年以上未実施のまま Issue の TODO に残っていた。
 * 決定が文章のままだと落ちるので、実装されている状態を検査で保つ。
 *
 * 併せて、文言が各画面へ直書きで散らばることも止める。散らばると
 * 【機能を出すときにも取り下げるときにも消し漏れる】＝果たされない約束が本番に residue として残る。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ONLINE_PREPAYMENT_NOTICE, WAITLIST_NOTICE } from '@/lib/coming-soon';

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), 'utf8');
}

describe('近日公開の表示（Issue #408 / #409）', () => {
  it('Issue #408: 予約詳細に支払い方法の案内が出る', () => {
    const source = read('src/app/mypage/bookings/[id]/page.tsx');
    expect(source).toContain('ONLINE_PREPAYMENT_NOTICE');
    // 空振り防止: 合計金額を出している画面であることを確かめてから配線を主張する。
    expect(source).toContain('合計');
  });

  it('Issue #408: これから支払いが発生する予約にだけ出す（済んだ予約へ誤案内しない）', () => {
    const source = read('src/app/mypage/bookings/[id]/page.tsx');
    // canCancel が偽＝キャンセル済み・来店済み・無断キャンセル。そこへ
    // 「店舗でお支払いください」と出すのは誤案内なので、必ず条件付きで描く。
    expect(source).toContain('{canCancel && <p className="text-xs text-gray-400">{ONLINE_PREPAYMENT_NOTICE}</p>}');
  });

  it('Issue #408: 決済導線そのものは出さない（決定どおり）', () => {
    const source = read('src/app/mypage/bookings/[id]/page.tsx');
    expect(source).not.toContain('payment/checkout');
  });

  it('Issue #409: 空き枠が無いと分かった位置にキャンセル待ちの案内が出る', () => {
    const source = read('src/components/booking/BookingFlow.tsx');
    expect(source).toContain('WAITLIST_NOTICE');
    expect(source).toContain('この期間は予約可能な時間帯がありません');
  });

  it('Issue #409: キャンセル待ちの登録 UI は出さない（決定どおり）', () => {
    const source = read('src/components/booking/BookingFlow.tsx');
    expect(source).not.toContain('/api/waitlist');
  });

  it('文言は単一ソースにあり、画面へ直書きされていない', () => {
    const screens = [
      'src/app/mypage/bookings/[id]/page.tsx',
      'src/components/booking/BookingFlow.tsx',
    ];
    for (const screen of screens) {
      const source = read(screen);
      expect(source).not.toContain(ONLINE_PREPAYMENT_NOTICE);
      expect(source).not.toContain(WAITLIST_NOTICE);
    }
  });

  it('文言は「近日公開」であることを明示する（実装済みと誤解させない）', () => {
    expect(ONLINE_PREPAYMENT_NOTICE).toContain('近日公開');
    expect(WAITLIST_NOTICE).toContain('近日公開');
  });
});
