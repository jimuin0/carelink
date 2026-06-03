/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/revalidate.ts（施設公開ページの on-demand 再検証窓口・round6）
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
const mockSingle = jest.fn();
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: mockSingle }) }) }),
  }),
}));

import { revalidateFacilityPublicPages, revalidateFacilityById } from '../revalidate';
import { revalidatePath } from 'next/cache';

describe('revalidateFacilityPublicPages', () => {
  afterEach(() => jest.clearAllMocks());

  test('slug あり → /facility/[slug] を layout 単位で再検証', () => {
    revalidateFacilityPublicPages('test-salon');
    expect(revalidatePath).toHaveBeenCalledWith('/facility/test-salon', 'layout');
  });

  test('slug が null → 何もしない', () => {
    revalidateFacilityPublicPages(null);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test('slug が undefined/空文字 → 何もしない', () => {
    revalidateFacilityPublicPages(undefined);
    revalidateFacilityPublicPages('');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('revalidateFacilityById', () => {
  afterEach(() => jest.clearAllMocks());

  test('facility_id から slug 解決 → 再検証', async () => {
    mockSingle.mockResolvedValue({ data: { slug: 'salon-x' }, error: null });
    await revalidateFacilityById('fac-1');
    expect(revalidatePath).toHaveBeenCalledWith('/facility/salon-x', 'layout');
  });

  test('施設が見つからない(data null) → 再検証しない', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    await revalidateFacilityById('fac-x');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test('クエリが throw → 握って無視（本処理に影響させない）', async () => {
    mockSingle.mockRejectedValue(new Error('db down'));
    await expect(revalidateFacilityById('fac-1')).resolves.toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
