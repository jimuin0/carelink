/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
/**
 * Microsoft Clarity（セッション録画）を動かしてよい画面の判定（2026年10月22日 新設）。
 *
 * 【不具合】Clarity が初めて実際に録画を送るようになったのに、計測タグは root layout にあり
 * 管理画面・マイページ・予約・問診でも動いていた。Clarity の既定のマスクは入力欄しか隠さないため、
 * 店舗オーナーが同意して /admin/customers を開くと、同意していないお客様の氏名・電話番号・
 * メールアドレスが録画として Microsoft へ送られる状態だった。
 *
 * 判定は許可リスト。ここでは「録画してよい画面」「録画しない画面」に加えて、src/app 直下の
 * 画面がどちらかに必ず分類されていること（分類漏れ・消えた画面の残骸が無いこと）を固定する。
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  SESSION_RECORDING_PRIVATE_ROOTS,
  SESSION_RECORDING_PUBLIC_ROOTS,
  isSessionRecordingAllowedPath,
} from '../session-recording-scope';

describe('録画してよい公開ページ', () => {
  test.each([
    '/',
    '/search',
    '/search/area/osaka',
    '/compare',
    '/ranking/tokyo',
    '/facility',
    '/facility/some-salon',
    '/facility/some-salon/',
    '/facility/some-salon/staff/hanako',
    '/facility/some-salon/catalog',
    '/blog/hello',
    '/feature/spring',
    '/symptom-checker',
    '/type/hair-salon',
    '/salon/premium',
    '/privacy',
    '/tokyo',
    '/osaka/toyonaka/hair-salon',
  ])('%s', (path) => {
    expect(isSessionRecordingAllowedPath(path)).toBe(true);
  });
});

describe('録画しない画面（お客様・店舗・申込者の情報を表示または入力する）', () => {
  test.each([
    '/admin',
    '/admin/customers',
    '/admin/customers/123',
    '/admin/bookings',
    '/mypage',
    '/mypage/bookings/abc',
    '/auth/login',
    '/auth/signup',
    '/intake/some-salon',
    '/liff/bookings',
    '/register',
    '/register/recover',
    '/recruit',
    '/contact',
    '/unsubscribe',
    '/facility/some-salon/booking',
    '/facility/some-salon/booking/complete',
  ])('%s', (path) => {
    expect(isSessionRecordingAllowedPath(path)).toBe(false);
  });

  test('分類していない画面・パスが分からないときは録画しない（新しい画面は安全側に倒れる）', () => {
    for (const path of ['/new-private-area', '/api/health', 'admin', '', null, undefined]) {
      expect(isSessionRecordingAllowedPath(path)).toBe(false);
    }
  });
});

describe('src/app 直下の画面の分類', () => {
  const APP = join(process.cwd(), 'src/app');
  // 画面ではないディレクトリ（API・テスト・フォント）と、都道府県スラッグの動的ルート（判定は isValidPrefectureSlug）。
  const NOT_PAGES = new Set(['api', '__tests__', 'fonts']);
  const roots = readdirSync(APP, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NOT_PAGES.has(entry.name) && !entry.name.startsWith('['))
    .map((entry) => entry.name)
    .sort();

  test('走査が空振りしていない', () => {
    expect(roots.length).toBeGreaterThan(20);
    expect(roots).toEqual(expect.arrayContaining(['admin', 'mypage', 'search', 'facility']));
  });

  test('すべての画面が「録画してよい」「録画しない」のどちらかに分類されている', () => {
    const classified = new Set([...SESSION_RECORDING_PUBLIC_ROOTS, ...SESSION_RECORDING_PRIVATE_ROOTS]);
    expect(roots.filter((root) => !classified.has(root))).toEqual([]);
  });

  test('分類に、もう存在しない画面や両方に載った画面が無い', () => {
    const all = [...SESSION_RECORDING_PUBLIC_ROOTS, ...SESSION_RECORDING_PRIVATE_ROOTS];
    expect(all.filter((root) => !roots.includes(root))).toEqual([]);
    expect(new Set(all).size).toBe(all.length);
  });

  test('録画しないと決めた画面は、判定でも録画しない', () => {
    for (const root of SESSION_RECORDING_PRIVATE_ROOTS) {
      expect(isSessionRecordingAllowedPath(`/${root}`)).toBe(false);
    }
  });
});
