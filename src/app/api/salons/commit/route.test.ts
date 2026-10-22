/** @jest-environment node */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: null, checkRateLimit: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn(() => ({})) }));
jest.mock('@/lib/salon-submission-commit', () => ({
  ...jest.requireActual('@/lib/salon-submission-commit'), commitSalonSubmission: jest.fn(),
}));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@/lib/salon-submission-intent', () => ({ readSalonIntentStatus: jest.fn() }));
import { NextResponse } from 'next/server';
import { POST } from './route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { commitSalonSubmission } from '@/lib/salon-submission-commit';
import { readSalonIntentStatus } from '@/lib/salon-submission-intent';
import { salonIntentCookieName } from '@/lib/salon-submission-proof';
import { businessTypes } from '@/lib/constants';
import { SALON_PR_TEXT_PROHIBITED_MESSAGE } from '@/lib/salon-field-errors';

const intentId = '64000000-0000-4000-8000-000000000001';
const other = '64000000-0000-4000-8000-000000000002';
const input = { intentId, photoIds: [], consent: { terms_agreed: true, license_warranted: true }, registration: { facility_name: 'Synthetic', business_type: businessTypes[0],
  representative_name: 'Synthetic', contact_name: 'Synthetic', email: 'synthetic@example.invalid', phone: '09012345678', source: 'register' } };
const proof = 'ab'.repeat(32);
const cookie = `${salonIntentCookieName(intentId)}=${proof}`;
const flag = process.env.SALON_REGISTRATION_V2_ENABLED;
function request(body: unknown = input, value: string = cookie, raw?: string) {
  return new Request('https://localhost/api/salons/commit', { method: 'POST', headers: { cookie: value }, body: raw ?? JSON.stringify(body) });
}
beforeEach(() => {
  jest.clearAllMocks(); process.env.SALON_REGISTRATION_V2_ENABLED = 'true';
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (readSalonIntentStatus as jest.Mock).mockResolvedValue({ state: 'uncommitted' });
});
afterAll(() => { if (flag === undefined) delete process.env.SALON_REGISTRATION_V2_ENABLED; else process.env.SALON_REGISTRATION_V2_ENABLED = flag; });
test('rollback allows issued intent reconciliation without preparing a new intent', async () => {
  delete process.env.SALON_REGISTRATION_V2_ENABLED;
  (commitSalonSubmission as jest.Mock).mockResolvedValue({ state: 'replay', receiptId: other });
  const res = await POST(request()); expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.json()).toEqual({ state: 'replay', receiptId: other });
  expect(commitSalonSubmission).toHaveBeenCalledWith({}, input, proof);
});
test('rollback still rejects a missing capability before persistence', async () => {
  delete process.env.SALON_REGISTRATION_V2_ENABLED;
  expect((await POST(request(input, ''))).status).toBe(403);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('CSRF and rate limit block before commit', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({}, { status: 403 }));
  expect((await POST(request())).status).toBe(403);
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(true);
  expect((await POST(request())).status).toBe(429); expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test.each([{}, { ...input, url: 'other' }, { ...input, photoIds: ['bad'] }])('invalid input blocks persistence %#', async body => {
  expect((await POST(request(body))).status).toBe(400); expect(commitSalonSubmission).not.toHaveBeenCalled();
});
test('field errors are fixed messages, not submitted PII/provider text', async () => {
  const res = await POST(request({ ...input, registration: { ...input.registration, email: 'PRIVATE-INVALID', phone: 'PRIVATE' } }));
  const body = await res.json(); expect(res.status).toBe(400);
  expect(body.fieldErrors).toEqual({ email: 'メールアドレスを確認してください（254文字以内）', phone: '電話番号を確認してください' });
  expect(JSON.stringify(body)).not.toContain('PRIVATE');
});
// /admin/settings と同じ医療広告ガイドライン・あはき法の検査。以前の /register は PR 文を一度も
// 検査せず、取り込み後は施設紹介としてそのまま公開候補になっていた。
test.each(['当院の施術で必ず治る', '技術力No.1のサロン'])('prohibited advertising in PR text is rejected under pr_text: %s', async prText => {
  const res = await POST(request({ ...input, registration: { ...input.registration, pr_text: prText } }));
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body).toEqual({ state: 'invalid', fieldErrors: { pr_text: SALON_PR_TEXT_PROHIBITED_MESSAGE } });
  // 送信値は返さない（固定文言のみ）。
  expect(JSON.stringify(body)).not.toContain(prText);
  expect(commitSalonSubmission).not.toHaveBeenCalled();
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test.each([null, '駅から徒歩3分。丁寧なカウンセリングを心がけています'])('acceptable PR text proceeds to commit: %p', async prText => {
  (commitSalonSubmission as jest.Mock).mockResolvedValue({ state: 'committed', receiptId: other });
  const body = { ...input, registration: { ...input.registration, pr_text: prText } };
  expect((await POST(request(body))).status).toBe(201);
  expect(commitSalonSubmission).toHaveBeenCalledWith({}, body, proof);
});
test('broken JSON blocks persistence', async () => {
  expect((await POST(request(input, cookie, '{'))).status).toBe(400); expect(commitSalonSubmission).not.toHaveBeenCalled();
});
test.each(['', `${salonIntentCookieName(intentId)}=bad`, `${salonIntentCookieName(other)}=${proof}`])('only the selected intent cookie is accepted %#', async value => {
  expect((await POST(request(input, value))).status).toBe(403); expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test.each([
  ['invalid', 400], ['unverified', 403], ['unavailable', 503], ['expired', 410],
  ['committed', 201], ['conflict', 409], ['photo_unverified', 409], ['unknown', 202], ['replay', 200], ['consent_required', 400],
])('maps %s explicitly without leaking proof or issuing a legacy cookie', async (state, status) => {
  const result = state === 'committed' || state === 'replay' ? { state, receiptId: other } : { state };
  (commitSalonSubmission as jest.Mock).mockResolvedValue(result);
  const res = await POST(request()); expect(res.status).toBe(status); expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.has('set-cookie')).toBe(false); expect(await res.json()).toEqual(result);
  expect(commitSalonSubmission).toHaveBeenCalledWith({}, input, proof);
});

test('omitted legacy declaration remains a grace request without inventing new consent',async()=>{
  const {consent,...legacy}=input;void consent;
  (commitSalonSubmission as jest.Mock).mockResolvedValue({state:'replay',receiptId:other});
  const res=await POST(request(legacy));expect(res.status).toBe(200);
  expect(commitSalonSubmission).toHaveBeenCalledWith({},legacy,proof);
});
test.each([null,{terms_agreed:false,license_warranted:true},{terms_agreed:true,license_warranted:false}])(
 'explicit invalid declaration %j keeps an unknown-result fence and never creates a receipt',async consent=>{
  const res=await POST(request({...input,consent}));expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({state:'consent_required'});
  expect(commitSalonSubmission).not.toHaveBeenCalled();
 });
test('prior commit is confirmed only after the original content comparison, without a fresh consent record',async()=>{
  const payload={...input,consent:{terms_agreed:false,license_warranted:true}};
  (readSalonIntentStatus as jest.Mock).mockResolvedValue({state:'committed',receiptId:other});
  (commitSalonSubmission as jest.Mock).mockResolvedValue({state:'replay',receiptId:other});
  const res=await POST(request(payload));expect(res.status).toBe(200);
  expect(await res.json()).toEqual({state:'replay',receiptId:other});
  expect(commitSalonSubmission).toHaveBeenCalledWith({}, {...payload,consent:undefined},proof);
});
test.each([{state:'conflict'},{state:'unknown'},{state:'replay',receiptId:intentId}])(
 'missing agreement cannot certify a mismatched original result %j',async result=>{
  (readSalonIntentStatus as jest.Mock).mockResolvedValue({state:'committed',receiptId:other});
  (commitSalonSubmission as jest.Mock).mockResolvedValue(result);
  expect((await POST(request({...input,consent:null}))).status).toBe(400);
 });
test.each([{consent:null},{...input,consent:null}])('invalid declaration with no selected proof performs no receipt lookup %#',async body=>{
 expect((await POST(request(body,''))).status).toBe(400);
 expect(readSalonIntentStatus).not.toHaveBeenCalled();expect(commitSalonSubmission).not.toHaveBeenCalled();
});
