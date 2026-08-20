import { mergeSalonRows, type SalonRow } from '@/lib/salon-merge';

// テスト用の salons Row を組み立てる共通ヘルパー。
// database.types.ts の Row の全列を明示的に埋め、overrides で上書きする。
function makeRow(overrides: Partial<SalonRow>): SalonRow {
  const base: SalonRow = {
    address: null,
    building_name: null,
    business_hours: null,
    business_type: '鍼灸院・整骨院',
    city: null,
    contact_name: '担当太郎',
    contact_phone: null,
    created_at: '2026-08-01T00:00:00.000Z',
    desired_start_date: null,
    email: 'owner@example.com',
    email_canonical: null,
    facility_name: 'サンプル整骨院',
    features: null,
    has_parking: null,
    id: 'row-base',
    is_public: null,
    nearest_station: null,
    phone: '0312345678',
    photo_url: null,
    photo_urls: null,
    postal_code: null,
    pr_text: null,
    prefecture: null,
    registration_followup_sent_at: null,
    regular_holiday: null,
    representative_name: '代表花子',
    seat_count: null,
    staff_count: null,
    status: null,
    website: null,
  };
  return { ...base, ...overrides };
}

describe('mergeSalonRows', () => {
  it('(i) 1行だけならその行がそのまま返る', () => {
    const row = makeRow({ id: 'only' });
    expect(mergeSalonRows([row])).toEqual(row);
  });

  it('(ii) register(古) + recruit(新) で、recruit が送らない列は register の値が残る', () => {
    // register 相当（先に作られた古い行）: /recruit が送らない列を全部持っている
    const registerRow = makeRow({
      id: 'register-row',
      created_at: '2026-08-01T00:00:00.000Z',
      photo_url: 'https://storage.example.com/salons/a/1.jpg',
      photo_urls: [
        'https://storage.example.com/salons/a/1.jpg',
        'https://storage.example.com/salons/a/2.jpg',
      ],
      business_hours: '9:00-18:00',
      regular_holiday: '水曜日',
      seat_count: 5,
      staff_count: 3,
      has_parking: true,
      features: ['駅近', '個室あり'],
      nearest_station: '渋谷駅',
      building_name: 'サンプルビル3F',
      desired_start_date: '2026-09-01',
    });
    // recruit 相当（後から作られた新しい行）: 10項目のみで上記は一切送らない＝null
    const recruitRow = makeRow({
      id: 'recruit-row',
      created_at: '2026-08-15T00:00:00.000Z',
      photo_url: null,
      photo_urls: null,
      business_hours: null,
      regular_holiday: null,
      seat_count: null,
      staff_count: null,
      has_parking: null,
      features: null,
      nearest_station: null,
      building_name: null,
      desired_start_date: null,
    });

    // rows は新しい順（recruit が先頭）で渡す
    const merged = mergeSalonRows([recruitRow, registerRow]);

    expect(merged).not.toBeNull();
    expect(merged!.photo_url).toBe('https://storage.example.com/salons/a/1.jpg');
    expect(merged!.photo_urls).toEqual([
      'https://storage.example.com/salons/a/1.jpg',
      'https://storage.example.com/salons/a/2.jpg',
    ]);
    expect(merged!.business_hours).toBe('9:00-18:00');
    expect(merged!.regular_holiday).toBe('水曜日');
    expect(merged!.seat_count).toBe(5);
    expect(merged!.staff_count).toBe(3);
    expect(merged!.has_parking).toBe(true);
    expect(merged!.features).toEqual(['駅近', '個室あり']);
    expect(merged!.nearest_station).toBe('渋谷駅');
    expect(merged!.building_name).toBe('サンプルビル3F');
    expect(merged!.desired_start_date).toBe('2026-09-01');
  });

  it('(iii) 両方が値を持つ列は新しい方が勝つ', () => {
    const older = makeRow({ id: 'older', created_at: '2026-08-01T00:00:00.000Z', pr_text: '旧PR文章' });
    const newer = makeRow({ id: 'newer', created_at: '2026-08-15T00:00:00.000Z', pr_text: '新PR文章' });

    const merged = mergeSalonRows([newer, older]);

    expect(merged!.pr_text).toBe('新PR文章');
    // id 自体も列なので新しい行の値が採用される
    expect(merged!.id).toBe('newer');
  });

  it('(iv) seat_count: 0 が「無し」に落ちない', () => {
    const older = makeRow({ id: 'older', seat_count: 8 });
    const newer = makeRow({ id: 'newer', seat_count: 0 });

    const merged = mergeSalonRows([newer, older]);

    // 新しい行が明示的に 0 を送っているので 0 が採用される（8 に落ちてはいけない）
    expect(merged!.seat_count).toBe(0);
  });

  it('(v) has_parking: false が「無し」に落ちない', () => {
    const older = makeRow({ id: 'older', has_parking: true });
    const newer = makeRow({ id: 'newer', has_parking: false });

    const merged = mergeSalonRows([newer, older]);

    // 新しい行が明示的に false を送っているので false が採用される（true に落ちてはいけない）
    expect(merged!.has_parking).toBe(false);
  });

  it('(vi) 空文字は「無し」として扱われ、古い方の値が残る', () => {
    const older = makeRow({ id: 'older', website: 'https://old.example.com' });
    const newer = makeRow({ id: 'newer', website: '' });

    const merged = mergeSalonRows([newer, older]);

    expect(merged!.website).toBe('https://old.example.com');
  });

  it('(vii) 空配列の扱い（自分が決めた仕様を固定する）: 古い行の非空配列が残る', () => {
    const older = makeRow({ id: 'older', features: ['駅近'], photo_urls: ['https://storage.example.com/a.jpg'] });
    const newer = makeRow({ id: 'newer', features: [], photo_urls: [] });

    const merged = mergeSalonRows([newer, older]);

    // 空配列は「無し」扱いなので、古い行が持っていた非空配列が勝つ
    expect(merged!.features).toEqual(['駅近']);
    expect(merged!.photo_urls).toEqual(['https://storage.example.com/a.jpg']);
  });

  it('(vii-b) 全行が空配列/nullなら最新行の値がそのまま残る', () => {
    const older = makeRow({ id: 'older', features: null });
    const newer = makeRow({ id: 'newer', features: [] });

    const merged = mergeSalonRows([newer, older]);

    // どの行にも意味のある値が無いので、最新行(rows[0])の値をそのまま返す
    expect(merged!.features).toEqual([]);
  });

  it('(viii) 空配列を渡すと null', () => {
    expect(mergeSalonRows([])).toBeNull();
  });

  // 🔴 列は「最新行の列」ではなく「全行の列の和集合」から取る。呼び出し側が select を
  //   狭めて最新行の列数が少なくなったとき、古い行にしか無い列が黙って落ちると、
  //   この関数が防ぐはずの「無音でデータが消える」故障を関数自身が作ってしまう。
  it('(ix) 最新行に無い列でも、古い行が持っていれば結果に残る（列は全行の和集合）', () => {
    const older = makeRow({ id: 'older', nearest_station: '梅田駅', seat_count: 8 });
    // 最新行は列が欠けた（狭い select 相当の）オブジェクト
    const newer = { id: 'newer', facility_name: '新しい申込' } as unknown as SalonRow;

    const merged = mergeSalonRows([newer, older])!;

    expect(merged.facility_name).toBe('新しい申込');
    expect(merged.nearest_station).toBe('梅田駅');
    expect(merged.seat_count).toBe(8);
  });

  it('(x) 最新行にしか無い列で、どの行にも意味のある値が無ければその行の値を据え置く', () => {
    // pr_text は older に存在しない列。newer は null を持つ＝意味のある値が1つも無い。
    const older = { id: 'older', facility_name: '古い申込' } as unknown as SalonRow;
    const newer = { id: 'newer', facility_name: '', pr_text: null } as unknown as SalonRow;

    const merged = mergeSalonRows([newer, older])!;

    expect(merged.facility_name).toBe('古い申込'); // 空文字は無し扱い → 古い行が勝つ
    expect(merged.pr_text).toBeNull();             // どの行にも値が無い → 据え置き
  });
});
