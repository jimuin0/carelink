/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registrationConsentSchema, REGISTRATION_TERMS_SHA256 } from '../registration-consent';

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
