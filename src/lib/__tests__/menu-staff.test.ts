import { buildMenuStaffMap, isStaffCompatibleWithMenus, filterEligibleStaff, type MenuStaffRow } from '../menu-staff';

describe('buildMenuStaffMap（menu_staff 行 → menuId->担当スタッフID配列 のマップ構築）', () => {
  test('空配列 → 空オブジェクト', () => {
    expect(buildMenuStaffMap([])).toEqual({});
  });

  test('同一メニューに複数スタッフの行 → 配列にまとめる', () => {
    const rows: MenuStaffRow[] = [
      { menu_id: 'menu-a', staff_id: 'staff-1' },
      { menu_id: 'menu-a', staff_id: 'staff-2' },
      { menu_id: 'menu-b', staff_id: 'staff-3' },
    ];
    expect(buildMenuStaffMap(rows)).toEqual({
      'menu-a': ['staff-1', 'staff-2'],
      'menu-b': ['staff-3'],
    });
  });
});

describe('isStaffCompatibleWithMenus（指名スタッフが選択中メニュー全てを担当できるか）', () => {
  test('staffId が null → 判定不要のため true', () => {
    expect(isStaffCompatibleWithMenus({ 'menu-a': ['staff-1'] }, ['menu-a'], null)).toBe(true);
  });

  test('staffId が undefined → 判定不要のため true', () => {
    expect(isStaffCompatibleWithMenus({ 'menu-a': ['staff-1'] }, ['menu-a'], undefined)).toBe(true);
  });

  test('selectedMenuIds が空（メニュー未選択）→ 判定対象なしのため true', () => {
    expect(isStaffCompatibleWithMenus({ 'menu-a': ['staff-1'] }, [], 'staff-2')).toBe(true);
  });

  test('選択中メニューが menuStaffMap にキーを持たない（行なし=無制限）→ true', () => {
    expect(isStaffCompatibleWithMenus({}, ['menu-a'], 'staff-9')).toBe(true);
  });

  test('選択中メニューが担当制(行あり)かつ対象スタッフに含まれる → true', () => {
    expect(isStaffCompatibleWithMenus({ 'menu-a': ['staff-1', 'staff-2'] }, ['menu-a'], 'staff-2')).toBe(true);
  });

  test('選択中メニューが担当制(行あり)かつ対象スタッフに含まれない → false（fail-closed）', () => {
    expect(isStaffCompatibleWithMenus({ 'menu-a': ['staff-1'] }, ['menu-a'], 'staff-9')).toBe(false);
  });

  test('複数選択メニューのうち1つでも担当外があれば false', () => {
    const map = { 'menu-a': ['staff-1'], 'menu-b': ['staff-1', 'staff-2'] };
    expect(isStaffCompatibleWithMenus(map, ['menu-a', 'menu-b'], 'staff-2')).toBe(false);
  });

  test('複数選択メニュー全てで担当（一部は行なし=無制限）なら true', () => {
    const map = { 'menu-a': ['staff-1', 'staff-2'] };
    expect(isStaffCompatibleWithMenus(map, ['menu-a', 'menu-b'], 'staff-2')).toBe(true);
  });

  test('menuStaffMap のキーが空配列（データ不整合の防御）→ 無制限扱い', () => {
    expect(isStaffCompatibleWithMenus({ 'menu-a': [] }, ['menu-a'], 'staff-9')).toBe(true);
  });
});

describe('filterEligibleStaff（選択中メニューを全て担当できるスタッフの絞込）', () => {
  const staffA = { id: 'staff-1', name: 'A' };
  const staffB = { id: 'staff-2', name: 'B' };

  test('selectedMenuIds が空（メニュー未選択）→ 絞り込まず全員を返す', () => {
    expect(filterEligibleStaff([staffA, staffB], { 'menu-a': ['staff-1'] }, [])).toEqual([staffA, staffB]);
  });

  test('担当制メニュー選択中 → 担当スタッフのみ残る', () => {
    expect(filterEligibleStaff([staffA, staffB], { 'menu-a': ['staff-1'] }, ['menu-a'])).toEqual([staffA]);
  });

  test('行なし(無制限)メニュー選択中 → 全員残る', () => {
    expect(filterEligibleStaff([staffA, staffB], {}, ['menu-a'])).toEqual([staffA, staffB]);
  });

  test('誰も担当していない場合 → 空配列', () => {
    expect(filterEligibleStaff([staffA, staffB], { 'menu-a': ['staff-9'] }, ['menu-a'])).toEqual([]);
  });
});
