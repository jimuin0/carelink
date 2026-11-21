import { createStageTimer } from '../stage-timer';
test('logs stage durations only when the total reaches the threshold', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const times = [0, 1000, 1500, 4000];
  const slow = createStageTimer('t', 3000, () => times.shift()!);
  slow.mark('verify'); slow.mark('select'); slow.mark('reads');
  expect(slow.finish()).toBe(4000);
  expect(warn).toHaveBeenCalledWith('[t] slow', { verify: 1000, select: 500, reads: 2500, total: 4000 });
  warn.mockClear();
  const fastTimes = [0, 100];
  const fast = createStageTimer('t', 3000, () => fastTimes.shift()!);
  fast.mark('verify');
  expect(fast.finish()).toBe(100); expect(warn).not.toHaveBeenCalled();
  expect(createStageTimer('t').finish()).toBe(0);
  warn.mockRestore();
});
