/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LICENSE_WARRANTY_TEXT, registrationConsentSchema, REGISTRATION_TERMS_SHA256 } from '../registration-consent';

test.each([undefined,null,{}, {terms_agreed:false,license_warranted:true},
  {terms_agreed:true,license_warranted:false}, {terms_agreed:'true',license_warranted:true},
  {terms_agreed:true,license_warranted:true,role:'admin'}])('new declarations require exact fresh true values: %j', value => {
  expect(registrationConsentSchema.safeParse(value).success).toBe(false);
});
test('new declarations do not contain an identity or a restored draft capability', () => {
  expect(registrationConsentSchema.parse({terms_agreed:true,license_warranted:true}))
    .toEqual({terms_agreed:true,license_warranted:true});
});
test('recorded policy edition identifies the actual Terms/Privacy and shared notice content', () => {
  const digest=createHash('sha256');
  for(const path of ['src/app/terms/page.tsx','src/app/privacy/page.tsx','src/lib/account-deletion-policy.ts']) {
    digest.update(path+'\0');digest.update(readFileSync(join(process.cwd(),path)));digest.update('\0');
  }
  expect(digest.digest('hex')).toBe(REGISTRATION_TERMS_SHA256);
});

// 2026年10月23日: 業種に整体を含めたため、許認可の表明を「資格が法令上必要な施術は資格者が行う」に改めた。
// 規約 第12条の表明保証と同じ意味なので規約本文（＝上の版の指紋）は変えていない。
test('license declaration matches Terms art. 12 and is shown from one source on every registration screen', () => {
  const terms = readFileSync(join(process.cwd(), 'src/app/terms/page.tsx'), 'utf8');
  expect(terms).toContain('法令上必要な国家資格等を有する者が当該施術・サービスを提供すること');
  expect(LICENSE_WARRANTY_TEXT).toContain('国家資格が必要な施術');
  for (const path of ['src/components/register/RegisterForm.tsx', 'src/app/admin/onboarding/page.tsx', 'src/app/recruit/page.tsx']) {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    expect(source).toContain('{LICENSE_WARRANTY_TEXT}');
    expect(source).not.toContain('施術は必要な資格を有する者が提供');
  }
});
