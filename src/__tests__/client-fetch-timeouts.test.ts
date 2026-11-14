import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 応答が返らないと「送信中」「読み込み中」のまま固まる画面に時間切れを付けたことを固定する（点検 B8-L）。
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

test.each([
  ['src/app/contact/page.tsx', 1],
  ['src/app/liff/cancel/page.tsx', 3],
])('%s の fetch は時間切れを持つ', (file, expected) => {
  const src = read(file);
  const fetches = (src.match(/\bfetch\(/g) ?? []).length;
  const timeouts = (src.match(/AbortSignal\.timeout\(/g) ?? []).length;
  expect(fetches).toBe(expected);
  expect(timeouts).toBe(fetches);
});
