import {
  isHttpUrl, normalizeWebsiteUrl, settingsErrorSummary, settingsFieldErrors, SETTINGS_FIELD_LABELS,
} from '../facility-settings-input';

describe('normalizeWebsiteUrl', () => {
  test.each([
    ['www.example.com', 'https://www.example.com'],
    ['  example.com/path  ', 'https://example.com/path'],
    ['http://example.com', 'http://example.com'],
    ['HTTPS://Example.com', 'HTTPS://Example.com'],
    ['', ''],
    ['   ', ''],
  ])('%p → %p', (input, expected) => {
    expect(normalizeWebsiteUrl(input)).toBe(expected);
  });

  test.each([null, undefined, 42])('文字列以外（%p）は検査に任せてそのまま返す', (value) => {
    expect(normalizeWebsiteUrl(value)).toBe(value);
  });
});

test('isHttpUrl は http(s) だけを受け付ける', () => {
  expect(isHttpUrl('https://example.com')).toBe(true);
  expect(isHttpUrl('http://example.com')).toBe(true);
  expect(isHttpUrl('javascript://example.com')).toBe(false);
});

describe('settingsFieldErrors', () => {
  test('欄ごとに1つだけ、欄名つきの文言にする（Web サイトは例つき）', () => {
    expect(settingsFieldErrors([
      { path: ['name'] }, { path: ['name'] }, { path: ['website_url'] }, { path: ['business_hours', 'mon', 'open'] },
    ])).toEqual({
      name: '施設名の入力内容を確認してください',
      website_url: 'WebサイトのURLを確認してください（例: https://example.com）',
      business_hours: '営業時間の入力内容を確認してください',
    });
  });

  test('欄の分からない問題は「_」にまとめる', () => {
    expect(settingsFieldErrors([{ path: [] }, { path: ['unknown_key'] }])).toEqual({
      _: '入力内容を確認してください',
      unknown_key: '入力内容を確認してください',
    });
  });
});

describe('settingsErrorSummary', () => {
  test('欄名を並べる', () => {
    expect(settingsErrorSummary({ name: 'x', website_url: 'y', _: 'z' })).toBe('入力内容を確認してください：施設名、Webサイト');
  });
  test('欄名が無ければ一般的な文言', () => {
    expect(settingsErrorSummary({ _: 'z' })).toBe('入力内容を確認してください');
  });
});

test('住所欄の名前は画面のラベル（町名・番地）と揃える', () => {
  expect(SETTINGS_FIELD_LABELS.address).toBe('町名・番地');
});
