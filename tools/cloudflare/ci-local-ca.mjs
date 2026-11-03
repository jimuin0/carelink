// Ephemeral, loopback-only CA for workerd's local Supabase TLS dependency.
// Private keys never leave this temporary directory or appear in process output.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function createWorkerLocalCertificate() {
  const directory = mkdtempSync(join(tmpdir(), 'carelink-worker-ci-ca-'));
  const openssl = args => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore', timeout: 15000 });
  try {
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-subj', '/CN=CareLink disposable CI CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost']);
    writeFileSync(join(directory, 'extensions.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n', { mode: 0o600 });
    openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'extensions.cnf']);
    return { key: readFileSync(join(directory, 'server.key')), cert: readFileSync(join(directory, 'server.pem')), ca: readFileSync(join(directory, 'ca.pem')) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
