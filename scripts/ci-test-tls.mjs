import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Private material stays in process memory and a pipe, never a file or log.
export function createLocalCertificate() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const cert = execFileSync('/bin/sh', ['-c', 'cat | openssl "$@"', 'ci-test-certificate',
    'req', '-new', '-x509', '-key', '/dev/stdin', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-days', '1',
  ], { input: key, env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 });
  return { key, cert };
}
