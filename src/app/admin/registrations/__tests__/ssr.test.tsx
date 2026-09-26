/** @jest-environment node */
import { renderToStaticMarkup } from 'react-dom/server';
import Page from '../page';

test('server HTML does not accept search input before the React handlers are attached', () => {
  const html = renderToStaticMarkup(<Page />);
  expect(html).toMatch(/<fieldset disabled=""[^>]*>[\s\S]*aria-label="検索値"[\s\S]*検索する[\s\S]*<\/fieldset>/);
  expect(html).toMatch(/<button type="button" disabled="">一覧を再読み込み<\/button>/);
});
