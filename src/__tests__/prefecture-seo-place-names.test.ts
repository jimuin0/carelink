/**
 * 実在しない地名を SEO 文言に載せない（A407）。
 * 鹿児島市は政令指定都市ではなく行政区が無いため「鹿児島市中央区」は存在しない。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'data', 'prefecture-seo.ts'), 'utf8');

describe('prefecture-seo の地名', () => {
  it('行政区の無い市に区名を付けていない', () => {
    for (const nonexistent of ['鹿児島市中央区']) {
      expect(SRC).not.toContain(nonexistent);
    }
  });
});
