import { databaseDiagnostic } from '../database-diagnostic';

test.each(['57014', '23505', 'PGRST202'])('preserves the bounded database code %s without copying details', code => {
  const cause = { code, message: 'private customer@example.com re_SECRET', details: 'private record', hint: 'private hint' };
  const diagnostic = databaseDiagnostic(cause);
  expect(diagnostic.message).toBe(`DATABASE_FAILURE:${code}`);
  expect(String(diagnostic.stack)).not.toMatch(/customer@example|re_SECRET|private record|private hint/);
  expect(diagnostic).not.toHaveProperty('cause');
});

test.each([null, undefined, false, 'private token', {}, { code: null }, { code: 57014 },
  { code: 'PGRST202 secret' }, { code: 'private@example.com' }, { code: '57014\nprivate' },
  { code: '57014\n' }, { code: 'PGRST202\r\n' }])(
  'unknown or malformed causes use a fixed diagnostic (%p)', cause => {
    expect(databaseDiagnostic(cause).message).toBe('DATABASE_FAILURE:UNCLASSIFIED');
  });
