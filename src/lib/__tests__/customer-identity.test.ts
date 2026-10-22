/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { customerIdentityKey, ledgerPhoneLinks, MIN_PHONE_DIGITS, phoneDigits, phoneIdentityKey, PHONE_KEY_PREFIX } from '../customer-identity';

describe('phoneDigits', () => {
  test.each([
    ['090-1111-2222', '09011112222'],
    ['09011112222', '09011112222'],
    ['０９０－１１１１－２２２２', '09011112222'],
    ['０９０1111 2222', '09011112222'],
    ['03 (1234) 5678', '0312345678'],
    ['+81 90-1111-2222', '819011112222'],
  ])('%s → %s（区切り・全角数字の揺れを吸収）', (input, expected) => {
    expect(phoneDigits(input)).toBe(expected);
  });

  test.each([null, undefined, '', '1234', '123-4567-8', 'なし', '－－－'])('識別に使えない電話番号 %p は null', (input) => {
    expect(phoneDigits(input)).toBeNull();
  });

  test('10 桁ちょうどから識別に使う（境界）', () => {
    expect(MIN_PHONE_DIGITS).toBe(10);
    expect(phoneDigits('012345678')).toBeNull();
    expect(phoneDigits('0123456789')).toBe('0123456789');
  });
});

describe('customerIdentityKey', () => {
  test('メールがあればメール（Gmail のエイリアスは同じ人）。電話番号は見ない', () => {
    expect(customerIdentityKey('F.O.O+shop@Gmail.com', '090-1111-2222')).toBe('foo@gmail.com');
    expect(customerIdentityKey('foo@gmail.com', null)).toBe('foo@gmail.com');
  });

  test('メールが無い・空白だけなら電話番号', () => {
    expect(customerIdentityKey(null, '090-1111-2222')).toBe(`${PHONE_KEY_PREFIX}09011112222`);
    expect(customerIdentityKey('  ', '０９０１１１１２２２２')).toBe('tel:09011112222');
    expect(customerIdentityKey(undefined, '09011112222')).toBe('tel:09011112222');
  });

  test('どちらも無ければ null（名前で別の人をまとめない）', () => {
    expect(customerIdentityKey(null, null)).toBeNull();
    expect(customerIdentityKey('', '1234')).toBeNull();
  });

  test('canonical 済みのメールを渡しても同じキー（DB の email_canonical を渡す cron と一致）', () => {
    const raw = 'F.o.o+x@googlemail.com';
    expect(customerIdentityKey(customerIdentityKey(raw, null), null)).toBe(customerIdentityKey(raw, null));
  });
});

describe('phoneIdentityKey', () => {
  test('電話番号だけのキー。識別に使えない番号は null', () => {
    expect(phoneIdentityKey('090-1111-2222')).toBe('tel:09011112222');
    expect(phoneIdentityKey('1234')).toBeNull();
    expect(phoneIdentityKey(null)).toBeNull();
  });
});

describe('ledgerPhoneLinks（メールのあるお客様へ寄せてよい電話番号）', () => {
  test('台帳でその電話番号を持つのがメールのあるお客様 1 人だけなら、そのメールのキーへ寄せる', () => {
    expect(ledgerPhoneLinks([
      { email: 'F.O.O@gmail.com', phone: '090-1111-2222' },
      { email: 'b@example.com', phone: null },
      { email: 'c@example.com', phone: '1234' },
    ])).toEqual(new Map([['tel:09011112222', 'foo@gmail.com']]));
  });

  test('同じ電話番号のお客様が 2 人以上（電話番号だけのお客様を含む）なら寄せない', () => {
    expect(ledgerPhoneLinks([
      { email: 'a@example.com', phone: '090-1111-2222' },
      { email: 'b@example.com', phone: '０９０１１１１２２２２' },
      { email: 'c@example.com', phone: '080-3333-4444' },
      { email: null, phone: '08033334444' },
    ]).size).toBe(0);
  });

  test('メールの無いお客様だけの電話番号は寄せない（そのお客様は電話番号のキーで直接突合される）', () => {
    expect(ledgerPhoneLinks([{ email: ' ', phone: '090-1111-2222' }, { email: null, phone: '080-3333-4444' }]).size).toBe(0);
  });
});
