/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@/lib/cabinet-holidays', () => ({ fetchCabinetHolidays: jest.fn() }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(async () => false) }));
import { GET } from '../route';
import { fetchCabinetHolidays } from '@/lib/cabinet-holidays';
import { checkRateLimit } from '@/lib/rate-limit';
const request = () => new Request('https://carelink.example.invalid/api/public/holidays');
beforeEach(() => { jest.clearAllMocks(); (checkRateLimit as jest.Mock).mockResolvedValue(false); });
test('確認済みの祝日を返す', async () => {
  (fetchCabinetHolidays as jest.Mock).mockResolvedValue({from:'2030-01-01',through:'2030-12-31',dates:new Set(['2030-01-07'])});
  const response=await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({from:'2030-01-01',through:'2030-12-31',dates:['2030-01-07']});
});
test('祝日が不明な場合は休業日を推測しない', async () => {
  (fetchCabinetHolidays as jest.Mock).mockResolvedValue(null);
  const response=await GET(request());
  expect(response.status).toBe(503);
});
test('頻繁な取得は制限する', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  const response=await GET(request());
  expect(response.status).toBe(429);
  expect(fetchCabinetHolidays).not.toHaveBeenCalled();
});
