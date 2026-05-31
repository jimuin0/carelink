/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/user.ts
 * Covers: getUserProfile, updateUserProfile, getUserFavorites,
 *         toggleFavorite, checkFavorite
 */

jest.mock('@/lib/supabase-server-auth');

import {
  getUserProfile,
  updateUserProfile,
  getUserFavorites,
  toggleFavorite,
  checkFavorite,
} from '../user';

const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');

const USER_ID = 'user-abc-123';
const FAC_ID = 'fac-xyz-456';

function buildMock(overrides: Partial<{
  user: object | null;
  profileData: object | null;
  profileError: object | null;
  updateError: object | null;
  favoritesData: object[];
  favoriteExisting: object | null;
  deleteError: object | null;
  insertError: object | null;
}> = {}) {
  const o = {
    user: { id: USER_ID },
    profileData: { id: USER_ID, display_name: 'Test User' },
    profileError: null,
    updateError: null,
    favoritesData: [],
    favoriteExisting: null,
    deleteError: null,
    insertError: null,
    ...overrides,
  };

  const mockMaybeSingleProfile = jest.fn().mockResolvedValue({ data: o.profileData, error: o.profileError });
  const mockEqProfile = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingleProfile });
  const mockSelectProfile = jest.fn().mockReturnValue({ eq: mockEqProfile });

  const mockUpdateEq = jest.fn().mockResolvedValue({ error: o.updateError });
  const mockUpdate = jest.fn().mockReturnValue({ eq: mockUpdateEq });

  const mockOrderFav = jest.fn().mockResolvedValue({ data: o.favoritesData });
  const mockEqFav = jest.fn().mockReturnValue({ order: mockOrderFav });
  const mockSelectFav = jest.fn().mockReturnValue({ eq: mockEqFav });

  const mockMaybeSingleCheck = jest.fn().mockResolvedValue({ data: o.favoriteExisting });
  const mockEqCheck2 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingleCheck });
  const mockEqCheck1 = jest.fn().mockReturnValue({ eq: mockEqCheck2 });
  const mockSelectCheck = jest.fn().mockReturnValue({ eq: mockEqCheck1 });

  const mockDeleteEq = jest.fn().mockResolvedValue({ error: o.deleteError });
  const mockDelete = jest.fn().mockReturnValue({ eq: mockDeleteEq });

  const mockInsert = jest.fn().mockResolvedValue({ error: o.insertError });

  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: o.user } }) },
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: mockSelectProfile,
          update: mockUpdate,
        };
      }
      if (table === 'favorites') {
        return {
          select: jest.fn((cols?: string) => {
            if (cols && cols.includes('facility:facility_profiles')) return { eq: mockEqFav };
            return { eq: mockEqCheck1 };
          }),
          delete: mockDelete,
          insert: mockInsert,
        };
      }
      return {};
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getUserProfile', () => {
  test('returns profile for authenticated user', async () => {
    buildMock();
    const result = await getUserProfile();
    expect(result).toEqual({ id: USER_ID, display_name: 'Test User' });
  });

  test('returns null when not authenticated', async () => {
    buildMock({ user: null });
    const result = await getUserProfile();
    expect(result).toBeNull();
  });
});

describe('updateUserProfile', () => {
  test('returns null error on success', async () => {
    buildMock();
    const result = await updateUserProfile({ display_name: 'New Name' });
    expect(result).toEqual({ error: null });
  });

  test('returns error message when unauthenticated', async () => {
    buildMock({ user: null });
    const result = await updateUserProfile({ display_name: 'X' });
    expect(result.error).toBe('認証が必要です');
  });

  test('returns error message on DB error', async () => {
    buildMock({ updateError: { message: 'DB error' } });
    const result = await updateUserProfile({ display_name: 'X' });
    expect(result.error).toBe('DB error');
  });
});

describe('getUserFavorites', () => {
  test('returns empty array when not authenticated', async () => {
    buildMock({ user: null });
    const result = await getUserFavorites();
    expect(result).toEqual([]);
  });

  test('returns favorites data for authenticated user', async () => {
    buildMock({
      favoritesData: [{ id: 'fav-1', facility: { id: FAC_ID } }],
    });
    const result = await getUserFavorites();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('checkFavorite', () => {
  test('returns false when not authenticated', async () => {
    buildMock({ user: null });
    expect(await checkFavorite(FAC_ID)).toBe(false);
  });

  test('returns false when not favorited', async () => {
    buildMock({ favoriteExisting: null });
    expect(await checkFavorite(FAC_ID)).toBe(false);
  });

  test('returns true when favorited', async () => {
    buildMock({ favoriteExisting: { id: 'fav-1' } });
    expect(await checkFavorite(FAC_ID)).toBe(true);
  });
});

describe('toggleFavorite', () => {
  test('returns error when not authenticated', async () => {
    buildMock({ user: null });
    const result = await toggleFavorite(FAC_ID);
    expect(result.error).toBe('認証が必要です');
    expect(result.isFavorited).toBe(false);
  });

  test('deletes existing favorite and returns isFavorited false', async () => {
    buildMock({ favoriteExisting: { id: 'fav-1' } });
    const result = await toggleFavorite(FAC_ID);
    expect(result.isFavorited).toBe(false);
    expect(result.error).toBeNull();
  });

  test('returns delete error message', async () => {
    buildMock({ favoriteExisting: { id: 'fav-1' }, deleteError: { message: 'del-err' } });
    const result = await toggleFavorite(FAC_ID);
    expect(result.isFavorited).toBe(false);
    expect(result.error).toBe('del-err');
  });

  test('inserts new favorite and returns isFavorited true', async () => {
    buildMock({ favoriteExisting: null });
    const result = await toggleFavorite(FAC_ID);
    expect(result.isFavorited).toBe(true);
    expect(result.error).toBeNull();
  });

  test('returns insert error message', async () => {
    buildMock({ favoriteExisting: null, insertError: { message: 'ins-err' } });
    const result = await toggleFavorite(FAC_ID);
    expect(result.isFavorited).toBe(true);
    expect(result.error).toBe('ins-err');
  });
});

describe('getUserFavorites null data', () => {
  test('returns empty array when supabase returns null data', async () => {
    buildMock({ favoritesData: null as unknown as object[] });
    const result = await getUserFavorites();
    expect(result).toEqual([]);
  });
});

describe('updateUserProfile undefined error fallback', () => {
  test('returns null error when error is undefined', async () => {
    buildMock({ updateError: undefined as unknown as object | null });
    const result = await updateUserProfile({ display_name: 'X' });
    expect(result.error).toBeNull();
  });
});
