#!/usr/bin/env python3
"""Check the disposable project's PostgREST HEAD connection contract.

A response that silently closes a persistent connection can poison Kong's pool
and turn the next POST/PATCH into a 502. Never print rows, auth headers, or IPs.
"""
import ipaddress
import json
from pathlib import Path
import re
import socket
import subprocess
import sys

FIXED_IMAGE = 'public.ecr.aws/supabase/postgrest:v14.15'
REQUEST = (
    b'HEAD /facility_profiles?select=id&limit=0 HTTP/1.1\r\n'
    b'Host: local-rest\r\nPrefer: count=exact\r\n'
    b'Connection: keep-alive\r\nAccept: application/json\r\n\r\n'
)


def read_head(sock):
    sock.sendall(REQUEST)
    data = b''
    while b'\r\n\r\n' not in data:
        chunk = sock.recv(8192)
        if not chunk:
            return None
        data += chunk
        if len(data) > 65536:
            raise ValueError('HEAD header bound exceeded')
    lines = data.split(b'\r\n\r\n', 1)[0].decode('latin1').split('\r\n')
    status = int(lines[0].split()[1])
    headers = {}
    for line in lines[1:]:
        key, separator, value = line.partition(':')
        if not separator:
            raise ValueError('Malformed HEAD header')
        headers[key.lower()] = value.strip()
    return status, headers


def probe(host, port=3000, timeout=3):
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            first = read_head(sock)
            if first is None:
                return {'ok': False, 'reason': 'missing first HEAD response'}
            status, headers = first
            close = 'close' in {token.strip().lower() for token in headers.get('connection', '').split(',')}
            result = {'status': status, 'advertised_close': close,
                      'content_length_present': 'content-length' in headers}
            if status not in (200, 206):
                return {**result, 'ok': False, 'reason': 'HEAD rejected'}
            if close:
                return {**result, 'ok': True, 'reason': 'connection close advertised'}
            try:
                second = read_head(sock)
            except (OSError, ValueError):
                second = None
            reusable = second is not None and second[0] in (200, 206)
            return {**result, 'ok': reusable,
                    'reason': 'persistent connection reused' if reusable else 'connection closed without notice'}
    except (OSError, ValueError):
        return {'ok': False, 'reason': 'local HEAD probe failed'}


def local_target():
    root = Path(__file__).resolve().parent.parent
    config = (root / 'supabase/config.toml').read_text()
    project = re.search(r'^project_id\s*=\s*"([a-zA-Z0-9_-]+)"\s*$', config, re.M)
    if not project:
        raise ValueError('Local project ID is required')
    name = 'supabase_rest_' + project.group(1)
    info = json.loads(subprocess.check_output(['docker', 'inspect', '--type=container', name]))[0]
    if info['Name'] != '/' + name or not info['State']['Running']:
        raise ValueError('Expected local PostgREST container is not running')
    if info['Config']['Image'] != FIXED_IMAGE:
        raise ValueError('Local PostgREST image does not match the fixed CI pin')
    network = info['NetworkSettings']['Networks']['supabase_network_' + project.group(1)]
    address = ipaddress.ip_address(network['IPAddress'])
    ranges = [ipaddress.ip_network(value) for value in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')]
    if address.version != 4 or not any(address in block for block in ranges):
        raise ValueError('Only the project Docker bridge is allowed')
    return str(address)


def main():
    # Linux CI can reach its local Docker bridge directly. No hosted URL, key,
    # arbitrary CLI destination, or credential file is accepted by this check.
    if len(sys.argv) != 1:
        raise ValueError('No external destination arguments are accepted')
    result = probe(local_target())
    print(json.dumps({'image': FIXED_IMAGE, **result}))
    if not result['ok']:
        raise SystemExit('Local PostgREST HEAD connection contract failed')


if __name__ == '__main__':
    try:
        main()
    except (KeyError, OSError, ValueError, subprocess.CalledProcessError):
        raise SystemExit('Local PostgREST HEAD verification could not run')
