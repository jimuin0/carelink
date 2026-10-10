// Load scripts are restricted to disposable loopback development targets.
// This validates the destination; the caller still owns fixture/provider setup.
export function requireLocalLoadTarget(value) {
  const target = value || 'http://localhost:3000';
  const match = /^(https?):\/\/(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?\/?$/.exec(target);
  if (!match || (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535))) {
    throw new Error('Load tests require a disposable loopback target; production/remote targets are disabled.');
  }
  return target.replace(/\/$/, '');
}
