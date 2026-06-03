/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/revalidate.ts（施設公開ページの on-demand 再検証窓口・round6）
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { revalidateFacilityPublicPages } from '../revalidate';
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
