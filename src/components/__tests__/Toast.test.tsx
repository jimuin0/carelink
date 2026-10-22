import { render, screen } from '@testing-library/react';
import Toast from '../Toast';

// 500 番台の背景に白文字は 2.3〜3.8:1 で AA（4.5:1）に届かず、右寄せ固定で幅375pxの画面からはみ出していた。
test.each([
  ['success', 'status', 'bg-green-700'],
  ['error', 'alert', 'bg-red-700'],
  ['info', 'status', 'bg-blue-700'],
] as const)('%s は白文字で読める濃さの背景にする', (type, role, background) => {
  render(<Toast type={type} message="合成メッセージ" onClose={() => undefined} />);
  const classes = screen.getByRole(role).className.split(/\s+/);
  expect(classes).toContain(background);
  expect(classes.some(c => /^bg-(green|red|blue)-500$/.test(c))).toBe(false);
});

test('スマホでは左右に余白を取って画面内に収め、広い画面では右上に寄せる', () => {
  render(<Toast type="error" message={'長い文言'.repeat(20)} onClose={() => undefined} />);
  const toast = screen.getByRole('alert');
  expect(toast.className.split(/\s+/)).toEqual(expect.arrayContaining(['left-4', 'right-4', 'sm:left-auto', 'sm:max-w-sm']));
  expect(toast.className.split(/\s+/)).not.toContain('max-w-sm');
  expect(screen.getByText('長い文言'.repeat(20)).className).toContain('break-words');
});
