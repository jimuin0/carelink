import { businessTypeMenuGroups, MEDICAL_DIRECTORY_GROUPS, MENU_COVERED_TYPES, MEDICAL_DIRECTORY_HREF } from '../business-type-menu';
import { businessTypes } from '../constants';
import { medicalBusinessTypes } from '../medical-business-types';

test('医療以外の業種はメニューに、医療の区分は医療機関のページに、それぞれ漏れなく 1 回だけ載る', () => {
  const nonMedical = businessTypes.filter((t) => !medicalBusinessTypes.includes(t));
  expect([...MENU_COVERED_TYPES].sort()).toEqual([...nonMedical].sort());
  const listed = MEDICAL_DIRECTORY_GROUPS.flatMap((g) => g.types);
  expect([...listed].sort()).toEqual([...medicalBusinessTypes].sort());
  expect(new Set(listed).size).toBe(listed.length);
});

test('メニューは美容 → 鍼灸 → 医療 → その他の順で、医療は 1 項目だけ', () => {
  const groups = businessTypeMenuGroups((t) => `[${t}]`);
  expect(groups.map((g) => g.title)).toEqual(['美容・リラク', '鍼灸・整骨・整体', '医療', 'その他']);
  expect(groups[2]!.links).toEqual([{ label: '病院・クリニック・歯科', href: MEDICAL_DIRECTORY_HREF }]);
  expect(groups[0]!.links[0]).toEqual({ label: '[ヘアサロン]', href: '/search?type=%E3%83%98%E3%82%A2%E3%82%B5%E3%83%AD%E3%83%B3' });
});
