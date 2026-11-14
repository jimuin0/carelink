/**
 * 監査 A394: クーポンの有効期限は端末・サーバーの時刻帯ではなく JST の日付で出す。
 * 監査 A395: 席数・スタッフ数が 0 のとき、表に「0」という文字を出さない。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import CouponCard from '../CouponCard';
import AccessInfo from '../AccessInfo';
import type { Coupon, Facility } from '@/types';

test('クーポンの有効期限は JST の日付', () => {
  const coupon = { id: 'c1', name: 'テスト', coupon_type: 'all', discount_type: 'amount', discount_value: 500,
    description: null, valid_until: '2026-11-30T15:00:00Z' } as unknown as Coupon; // JST 2026-12-01 00:00
  expect(renderToStaticMarkup(<CouponCard coupon={coupon} />)).toContain('~2026/12/1');
});

test('席数・スタッフ数が 0 なら行ごと出さず「0」を描かない', () => {
  const facility = { id: 'f1', name: '検証', slug: 's', prefecture: '大阪府', city: '豊中市', address: '1-2-3', building: null,
    latitude: null, longitude: null, features: [], business_hours: null, phone: null, seat_count: 0, staff_count: 0 } as unknown as Facility;
  const markup = renderToStaticMarkup(<AccessInfo facility={facility} />);
  const tbody = markup.match(/<tbody>([\s\S]*?)<\/tbody>/)![1];
  expect(tbody).not.toMatch(/>0</);
  expect(markup).not.toContain('席数');
});
