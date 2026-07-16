/**
 * Tests for app/jobs/page.tsx — SHOW_JOBS フラグによる metadata.robots の分岐（両分岐）。
 * ページ本体のデータ取得・表示ロジックはこのPRでは変更していないため対象外。
 */

describe('jobs list page metadata SHOW_JOBS branch', () => {
  test('SHOW_JOBS=false のとき robots: noindex,nofollow が付与される', () => {
    let metadata!: { robots?: { index: boolean; follow: boolean } };
    jest.isolateModules(() => {
      jest.doMock('@/lib/feature-toggles', () => ({ SHOW_JOBS: false }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      metadata = require('../page').metadata;
    });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  test('SHOW_JOBS=true のとき robots は付与されない（既定のインデックス可）', () => {
    let metadata!: { robots?: { index: boolean; follow: boolean } };
    jest.isolateModules(() => {
      jest.doMock('@/lib/feature-toggles', () => ({ SHOW_JOBS: true }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      metadata = require('../page').metadata;
    });
    expect(metadata.robots).toBeUndefined();
  });
});
