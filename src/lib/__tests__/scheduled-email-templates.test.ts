/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {buildFavoritesDigestEnvelope,buildReviewRequestEnvelope} from '../email';
test.each(['<script>customer</script>',null,''])('review template escapes input, keeps fallback and encodes the facility link: %s',customerName=>{
  const e=buildReviewRequestEnvelope({email:'synthetic@example.invalid',customerName,facilityName:'A <clinic>',facilitySlug:'a/"?'});
  expect(e.to).toBe('synthetic@example.invalid');expect(e.subject).toContain('ご来店ありがとうございました');
  expect(e.html).toContain('A &lt;clinic&gt;');expect(e.html).toContain(customerName?'&lt;script&gt;customer&lt;/script&gt;':'お客様');
  expect(e.html).toContain('a%2F%22%3F#review');
});
test('digest keeps its original template, escaped source and persistent unsubscribe link',()=>{
 const e=buildFavoritesDigestEnvelope({userEmail:'synthetic@example.invalid',userName:'<person>',unsubscribeToken:'synthetic-token',
   facilities:[{name:'<clinic>',slug:'a/?',newCoupons:2,hasNewMenus:true},{name:'Other',slug:'other',newCoupons:0,hasNewMenus:false}]});
 expect(e.to).toBe('synthetic@example.invalid');expect(e.html).toContain('&lt;person&gt;');expect(e.html).toContain('&lt;clinic&gt;');
 expect(e.html).toContain('a%2F%3F');expect(e.html).toContain('新着クーポン 2件');expect(e.html).toContain('新メニュー追加');
 expect(e.html).toContain('synthetic-token');
});
