import {
  SALON_CLAIM_COOKIE_NAME,
  SALON_CLAIM_TTL_SECONDS,
  signSalonClaim,
  verifySalonClaim,
} from '@/lib/salon-claim';

const SALON_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_SALON_ID = '22222222-2222-2222-2222-222222222222';

describe('salon-claim（POST /api/salons の所有権 claim Cookie）', () => {
  const ORIGINAL = process.env.ADMIN_COOKIE_SECRET;
  beforeEach(() => {
    process.env.ADMIN_COOKIE_SECRET = 'test-admin-cookie-secret';
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_COOKIE_SECRET;
    else process.env.ADMIN_COOKIE_SECRET = ORIGINAL;
  });

  it('Cookie 名は他と衝突しない固有の名前を持つ', () => {
    expect(SALON_CLAIM_COOKIE_NAME).toBe('clnk_salon_claim');
  });

  it('署名→検証のラウンドトリップで salons.id が一致する', () => {
    const now = Math.floor(Date.now() / 1000);
    const signed = signSalonClaim(SALON_ID, now);
    expect(signed).not.toBeNull();
    expect(verifySalonClaim(signed!, now)).toBe(SALON_ID);
  });

  it('別の salons.id では別の値になり、それぞれ正しく復元される', () => {
    const now = Math.floor(Date.now() / 1000);
    const a = signSalonClaim(SALON_ID, now)!;
    const b = signSalonClaim(OTHER_SALON_ID, now)!;
    expect(a).not.toBe(b);
    expect(verifySalonClaim(a, now)).toBe(SALON_ID);
    expect(verifySalonClaim(b, now)).toBe(OTHER_SALON_ID);
  });

  it('ADMIN_COOKIE_SECRET 未設定なら署名は null を返す（fail-safe・新規 env 不要）', () => {
    delete process.env.ADMIN_COOKIE_SECRET;
    expect(signSalonClaim(SALON_ID)).toBeNull();
  });

  it('ADMIN_COOKIE_SECRET 未設定なら検証も null を返す（正当な値であっても）', () => {
    const now = Math.floor(Date.now() / 1000);
    const signed = signSalonClaim(SALON_ID, now)!;
    delete process.env.ADMIN_COOKIE_SECRET;
    expect(verifySalonClaim(signed, now)).toBeNull();
  });

  it('部分数が3でない値は null（形式不正）', () => {
    expect(verifySalonClaim('a.b')).toBeNull();
    expect(verifySalonClaim('a.b.c.d')).toBeNull();
    expect(verifySalonClaim('no-dots-at-all')).toBeNull();
  });

  it('salonId が UUID 形式でない値は null', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifySalonClaim(`not-a-uuid.${now}.${'a'.repeat(64)}`)).toBeNull();
  });

  it('発行時刻が数字でない値は null', () => {
    expect(verifySalonClaim(`${SALON_ID}.not-a-number.${'a'.repeat(64)}`)).toBeNull();
  });

  it('発行時刻が安全な整数でない値は null（オーバーフロー対策）', () => {
    // Number.MAX_SAFE_INTEGER を超える桁数の数字文字列。
    expect(verifySalonClaim(`${SALON_ID}.99999999999999999999.${'a'.repeat(64)}`)).toBeNull();
  });

  it('署名が64桁16進文字列でない値は null（不正文字を黙って読み飛ばさない）', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifySalonClaim(`${SALON_ID}.${now}.not-hex`)).toBeNull();
    expect(verifySalonClaim(`${SALON_ID}.${now}.${'a'.repeat(63)}`)).toBeNull(); // 63桁(短い)
  });

  it('署名が改ざんされた値は null（HMAC 不一致）', () => {
    const now = Math.floor(Date.now() / 1000);
    const signed = signSalonClaim(SALON_ID, now)!;
    const parts = signed.split('.');
    const tamperedSig = parts[2][0] === 'a' ? 'b' + parts[2].slice(1) : 'a' + parts[2].slice(1);
    expect(verifySalonClaim(`${parts[0]}.${parts[1]}.${tamperedSig}`, now)).toBeNull();
  });

  it('salonId 部分を差し替えても署名は流用できない（salonId ごとに別鍵材料）', () => {
    const now = Math.floor(Date.now() / 1000);
    const signed = signSalonClaim(SALON_ID, now)!;
    const [, issuedAt, sig] = signed.split('.');
    expect(verifySalonClaim(`${OTHER_SALON_ID}.${issuedAt}.${sig}`, now)).toBeNull();
  });

  it('TTL 内は有効', () => {
    const now = Math.floor(Date.now() / 1000);
    const signed = signSalonClaim(SALON_ID, now)!;
    expect(verifySalonClaim(signed, now + SALON_CLAIM_TTL_SECONDS)).toBe(SALON_ID);
  });

  it('🔴 サーバー側で独立に判定される TTL 超過は null（Cookie の maxAge を自己申告として信じない）', () => {
    const now = Math.floor(Date.now() / 1000);
    const signed = signSalonClaim(SALON_ID, now)!;
    expect(verifySalonClaim(signed, now + SALON_CLAIM_TTL_SECONDS + 1)).toBeNull();
  });

  it('未来方向のクロックスキュー（発行時刻が現在より後）も不正扱いで null', () => {
    const now = Math.floor(Date.now() / 1000);
    const signed = signSalonClaim(SALON_ID, now)!;
    expect(verifySalonClaim(signed, now - 1)).toBeNull();
  });

  it('引数省略時は現在時刻を使う（デフォルト引数の実動作を確認）', () => {
    const signed = signSalonClaim(SALON_ID);
    expect(signed).not.toBeNull();
    expect(verifySalonClaim(signed!)).toBe(SALON_ID);
  });
});
