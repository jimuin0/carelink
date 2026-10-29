import { z } from 'zod';
import { medicalBusinessTypeSlugs } from './medical-business-types';

/** 診療科のみ。病院・診療所などの施設区分は別に保持する。 */
export const medicalSpecialties = Object.entries(medicalBusinessTypeSlugs)
  .filter(([slug]) => !['hospital', 'general-hospital', 'general-clinic', 'other-medical-clinic'].includes(slug))
  .map(([, label]) => label);

/** 保存・検索に使うため、重複や未知の値を許可しない。 */
export const medicalSpecialtiesSchema = z.array(z.string())
  .max(medicalSpecialties.length)
  .refine(values => values.every(value => medicalSpecialties.includes(value)), '診療科を確認してください')
  .refine(values => new Set(values).size === values.length, '同じ診療科は複数選択できません');
