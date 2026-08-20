import { buildOnboardingRedirectPath, buildOnboardingAuthPath } from '../onboarding-link';

describe('buildOnboardingRedirectPath', () => {
  test('facility_name / business_type の両方があればクエリを両方載せる', () => {
    const path = buildOnboardingRedirectPath({ facilityName: 'テスト整骨院', businessType: '整骨院' });
    expect(path).toBe('/admin/onboarding?facility_name=%E3%83%86%E3%82%B9%E3%83%88%E6%95%B4%E9%AA%A8%E9%99%A2&business_type=%E6%95%B4%E9%AA%A8%E9%99%A2');

    // クエリ文字列としてラウンドトリップさせても元の日本語に戻る（実際に安全か）
    const url = new URL('https://carelink-jp.com' + path);
    expect(url.pathname).toBe('/admin/onboarding');
    expect(url.searchParams.get('facility_name')).toBe('テスト整骨院');
    expect(url.searchParams.get('business_type')).toBe('整骨院');
  });

  test('facility_name のみ（business_type 空文字）は facility_name だけ載せる', () => {
    const path = buildOnboardingRedirectPath({ facilityName: 'テスト', businessType: '' });
    const url = new URL('https://carelink-jp.com' + path);
    expect(url.searchParams.get('facility_name')).toBe('テスト');
    expect(url.searchParams.has('business_type')).toBe(false);
  });

  test('business_type のみ（facility_name 空文字）は business_type だけ載せる', () => {
    const path = buildOnboardingRedirectPath({ facilityName: '', businessType: '美容室' });
    const url = new URL('https://carelink-jp.com' + path);
    expect(url.searchParams.has('facility_name')).toBe(false);
    expect(url.searchParams.get('business_type')).toBe('美容室');
  });

  test('両方空ならクエリ無しの /admin/onboarding を返す', () => {
    const path = buildOnboardingRedirectPath({ facilityName: '', businessType: '' });
    expect(path).toBe('/admin/onboarding');
  });

  test('施設名に & ? # が含まれても安全にエンコードされ、ラウンドトリップで元に戻る', () => {
    const facilityName = '整骨院&接骨院?福祉#施設';
    const businessType = 'A&B';
    const path = buildOnboardingRedirectPath({ facilityName, businessType });

    // 危険な生文字がそのままパス文字列に混入していないこと
    // （生の & はクエリ区切りと衝突し、生の # はフラグメント区切りと衝突するため）
    // URLSearchParams が値としてエンコードするので、`&facility_name=` の直後に来る
    // 生の "&" はクエリ区切りとしての "&" ではなく、必ず1個だけ（business_type との区切り）。
    expect((path.match(/&/g) || []).length).toBe(1);
    expect(path.includes('#')).toBe(false);

    const url = new URL('https://carelink-jp.com' + path);
    expect(url.pathname).toBe('/admin/onboarding');
    expect(url.searchParams.get('facility_name')).toBe(facilityName);
    expect(url.searchParams.get('business_type')).toBe(businessType);
  });
});

describe('buildOnboardingAuthPath', () => {
  test('signup: /auth/signup?redirect=... の形で、redirect の中に onboarding パスがネストされる', () => {
    const authPath = buildOnboardingAuthPath('signup', { facilityName: 'テスト', businessType: '整骨院' });
    expect(authPath.startsWith('/auth/signup?redirect=')).toBe(true);

    // ネストされた redirect を実際に取り出し、safeRedirect と同じ手順で解決できることを主張する
    // （middleware.ts は request.nextUrl.searchParams.get('redirect') で取り出してから
    //   safeRedirect に渡す。ここでは URL 経由で同じ取り出し方を再現する）。
    const outer = new URL('https://carelink-jp.com' + authPath);
    const redirectRaw = outer.searchParams.get('redirect');
    expect(redirectRaw).not.toBeNull();
    const inner = new URL(redirectRaw as string, 'https://carelink-jp.com');
    expect(inner.pathname).toBe('/admin/onboarding');
    expect(inner.searchParams.get('facility_name')).toBe('テスト');
    expect(inner.searchParams.get('business_type')).toBe('整骨院');
  });

  test('login: /auth/login?redirect=... の形で、同じくネストされる', () => {
    const authPath = buildOnboardingAuthPath('login', { facilityName: 'サロンA', businessType: '美容室' });
    expect(authPath.startsWith('/auth/login?redirect=')).toBe(true);

    const outer = new URL('https://carelink-jp.com' + authPath);
    const redirectRaw = outer.searchParams.get('redirect');
    const inner = new URL(redirectRaw as string, 'https://carelink-jp.com');
    expect(inner.pathname).toBe('/admin/onboarding');
    expect(inner.searchParams.get('facility_name')).toBe('サロンA');
    expect(inner.searchParams.get('business_type')).toBe('美容室');
  });

  test('facility_name / business_type 無しでも /admin/onboarding へネストする（手入力フォームへの導線は維持）', () => {
    const authPath = buildOnboardingAuthPath('signup', { facilityName: '', businessType: '' });
    expect(authPath).toBe('/auth/signup?redirect=%2Fadmin%2Fonboarding');
  });
});
