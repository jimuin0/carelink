/**
 * 画面下部の固定バー（下部ナビ・施設詳細の予約バー）の出し分けと逃げの検査（2026年10月22日）。
 *
 * 守っているのは「一番下までスクロールしても、フッター最終行の利用規約・特商法表記が
 * 固定バーの下に隠れて押せない」状態を作らないこと。逃げは <main> ではなくフッターに付ける。
 */
import fs from 'fs';
import path from 'path';
import { FILTER_BUTTON_PATHS, bottomFixedBarsHeight, footerClearanceClass, mobileBottomBarFor } from '../mobile-bottom-bar';

describe('mobileBottomBarFor', () => {
  it.each([
    ['/', 'nav'],
    ['/search', 'nav'],
    ['/auth/login', 'nav'],
    ['/mypage/favorites', 'nav'],
    ['/facility', 'nav'],
    ['/facility/some-salon/staff', 'nav'],
    ['/facility/some-salon/catalog', 'nav'],
    ['/facility/some-salon', 'booking'],
    ['/facility/some-salon/booking', 'none'],
    ['/facility/some-salon/blog/post-1', 'none'],
    ['/facility/some-salon/staff/someone', 'none'],
  ])('%s → %s', (pathname, expected) => {
    expect(mobileBottomBarFor(pathname)).toBe(expected);
  });
});

describe('footerClearanceClass', () => {
  it('下部ナビのページはナビの高さぶん（lg 以上では付けない）', () => {
    expect(footerClearanceClass('/auth/login')).toBe('pb-[var(--mobile-nav-height)] lg:pb-0');
    expect(footerClearanceClass('/search/area')).toBe('pb-[var(--mobile-nav-height)] lg:pb-0');
  });
  it('「絞り込み」ボタンが浮くページは、ボタンの上端まで伸ばす（右寄せの特商法表記に重なるため）', () => {
    expect(footerClearanceClass('/search')).toBe('pb-[calc(var(--mobile-nav-height)+4.5rem)] lg:pb-0');
  });
  it('施設詳細は予約バーの上限ぶん（予約バーは全幅で出るので lg でも外さない）', () => {
    expect(footerClearanceClass('/facility/some-salon')).toBe('pb-[var(--booking-bar-clearance)]');
  });
  it('固定バーの無いページは付けない', () => {
    expect(footerClearanceClass('/facility/some-salon/booking')).toBe('');
  });
});

describe('FILTER_BUTTON_PATHS', () => {
  // 台帳が実態から腐らないこと：「絞り込み」ボタンを描くページと一致させる。
  function pagesRenderingFilterButton(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') found.push(...pagesRenderingFilterButton(full));
      } else if (/\.tsx$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes("from '@/components/search/MobileFilterButton'")) {
        found.push(full);
      }
    }
    return found;
  }

  it('ボタンを描くページのパスと一致する', () => {
    const appDir = path.join(process.cwd(), 'src/app');
    const routes = pagesRenderingFilterButton(appDir).map((file) => {
      expect(path.basename(file)).toBe('page.tsx');
      return '/' + path.relative(appDir, path.dirname(file)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s)).join('/');
    });
    expect(routes.length).toBeGreaterThan(0);
    expect([...routes].sort()).toEqual([...FILTER_BUTTON_PATHS].sort());
  });
});

describe('bottomFixedBarsHeight', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function bar(html: string, height: number) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const el = holder.firstElementChild as HTMLElement;
    jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect);
    document.body.appendChild(el);
    return el;
  }

  it('固定バーが無ければ 0', () => {
    expect(bottomFixedBarsHeight()).toBe(0);
  });

  it('目印の付いたバーのうち最も高いものを返す（非表示＝高さ 0 は数えない）', () => {
    bar('<nav data-bottom-fixed=""></nav>', 56);
    bar('<div data-bottom-fixed=""></div>', 0);
    bar('<div class="sticky-bar"></div>', 77);
    expect(bottomFixedBarsHeight()).toBe(77);
  });

  it('探す範囲を渡せる', () => {
    bar('<nav data-bottom-fixed=""></nav>', 56);
    const scope = document.createElement('section');
    expect(bottomFixedBarsHeight(scope)).toBe(0);
  });
});
