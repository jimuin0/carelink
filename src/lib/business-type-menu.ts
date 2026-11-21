/**
 * ヘッダーの「業種から探す」の並びと区切り（2026年11月22日 本人指示）。
 *
 * 以前は businessTypes（src/lib/constants.ts）をそのまま並べており、医療の区分（診療科 30 個近く）が
 * メニューに全部出て、CareLink 自体が病院のサイトに見えていた。お客様が探す順に
 * 「美容・リラク → 鍼灸・整骨・整体 → 医療 → その他」と区切り、医療はメニューでは 1 項目にまとめて
 * 診療科は医療機関のページ（/medical）で選ぶ。保存値（business_type）は変えない。
 */
import { businessTypes } from './constants';
import { medicalBusinessTypes } from './medical-business-types';

export interface BusinessTypeMenuLink { label: string; href: string }
export interface BusinessTypeMenuGroup { title: string; links: BusinessTypeMenuLink[] }

export const MEDICAL_DIRECTORY_HREF = '/medical';

const typeHref = (type: string) => `/search?type=${encodeURIComponent(type)}`;

const BEAUTY = ['ヘアサロン', 'ネイル・まつげサロン', 'リラクサロン', 'エステサロン', 'ピラティス', '美容クリニック'];
const BODY_CARE = ['鍼灸院・整骨院'];
const OTHER = ['その他'];

export function businessTypeMenuGroups(label: (type: string) => string): BusinessTypeMenuGroup[] {
  return [
    { title: '美容・リラク', links: BEAUTY.map((t) => ({ label: label(t), href: typeHref(t) })) },
    { title: '鍼灸・整骨・整体', links: BODY_CARE.map((t) => ({ label: label(t), href: typeHref(t) })) },
    { title: '医療', links: [{ label: '病院・クリニック・歯科', href: MEDICAL_DIRECTORY_HREF }] },
    { title: 'その他', links: OTHER.map((t) => ({ label: label(t), href: typeHref(t) })) },
  ];
}

/** 医療機関のページ（/medical）で使う区分。どの診療科も必ずどれか 1 つに入る（検査で固定）。 */
export const MEDICAL_DIRECTORY_GROUPS: ReadonlyArray<{ title: string; types: string[] }> = [
  { title: '病院・クリニック', types: ['病院', '総合病院', '診療所・クリニック（複数診療科）'] },
  { title: '内科系', types: ['内科', '呼吸器内科', '循環器内科', '消化器内科', '糖尿病内科', '腎臓内科', '脳神経内科', 'アレルギー科', 'リウマチ科'] },
  { title: '外科系', types: ['外科', '整形外科', '脳神経外科', '形成外科', 'リハビリテーション科'] },
  { title: 'こども・女性', types: ['小児科', '産婦人科', '婦人科'] },
  { title: '目・耳鼻・皮膚・泌尿器', types: ['眼科', '耳鼻咽喉科', '皮膚科', '泌尿器科'] },
  { title: 'こころ', types: ['精神科', '心療内科'] },
  { title: '歯科', types: ['歯科', '小児歯科', '矯正歯科', '歯科口腔外科'] },
  { title: 'その他', types: ['その他の医療機関'] },
];

export const MENU_COVERED_TYPES: readonly string[] = [...BEAUTY, ...BODY_CARE, ...OTHER];
export { businessTypes, medicalBusinessTypes, typeHref };
