import importlib.util
import json
from unittest import mock
from pathlib import Path
import socket
import threading
import unittest

spec = importlib.util.spec_from_file_location('wire', Path(__file__).with_name('check-local-postgrest-head.py'))
wire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)


class HeadConnectionContract(unittest.TestCase):
    def fixture(self, first, second=None):
        server = socket.socket()
        server.bind(('127.0.0.1', 0))
        server.listen(1)
        port = server.getsockname()[1]
        received = []

        def serve():
            try:
                conn, _ = server.accept()
                with conn:
                    conn.settimeout(1)
                    received.append(conn.recv(8192))
                    conn.sendall(first)
                    if second is not None:
                        received.append(conn.recv(8192))
                        conn.sendall(second)
            finally:
                server.close()
        worker = threading.Thread(target=serve, daemon=True)
        worker.start()
        result = wire.probe('127.0.0.1', port, timeout=1)
        worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertTrue(all(request.startswith(b'HEAD ') for request in received))
        return result

    def test_silent_close_reproduces_the_broken_upstream_contract(self):
        result = self.fixture(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n')
        self.assertFalse(result['ok'])
        self.assertEqual(result['reason'], 'connection closed without notice')

    def test_advertised_close_is_safe_for_the_gateway_pool(self):
        result = self.fixture(b'HTTP/1.1 206 Partial Content\r\nConnection: close\r\n\r\n')
        self.assertTrue(result['ok'])
        self.assertTrue(result['advertised_close'])

    def test_a_persistent_connection_must_accept_a_second_head(self):
        response = b'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n'
        result = self.fixture(response, response)
        self.assertTrue(result['ok'])
        self.assertFalse(result['advertised_close'])

    def test_an_unavailable_backend_cannot_pass_the_wire_gate(self):
        result = self.fixture(b'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
        self.assertFalse(result['ok'])
        self.assertEqual(result['reason'], 'HEAD rejected')


class LocalTargetScope(unittest.TestCase):
    def info(self, image='ghcr.io/supabase/postgrest:v14.15', address='172.18.0.2'):
        return {'Name': '/supabase_rest_carelink', 'State': {'Running': True},
                'Config': {'Image': image}, 'NetworkSettings': {'Networks': {
                    'supabase_network_carelink': {'IPAddress': address}}}}

    def inspect(self, info):
        return mock.patch.object(wire.subprocess, 'check_output', return_value=json.dumps(info).encode())

    def test_all_official_fallbacks_preserve_the_observed_image(self):
        self.assertTrue({'public.ecr.aws/supabase/postgrest:v14.15',
                         'ghcr.io/supabase/postgrest:v14.15',
                         'docker.io/supabase/postgrest:v14.15',
                         'supabase/postgrest:v14.15',
                         'postgrest/postgrest:v14.15'} <= wire.FIXED_IMAGES)
        for image in sorted(wire.FIXED_IMAGES):
            with self.subTest(image=image), self.inspect(self.info(image)) as inspect:
                self.assertEqual(wire.local_target(), ('172.18.0.2', image))
                inspect.assert_called_once_with(['docker', 'inspect', '--type=container', '--format', wire.INSPECT_FORMAT, 'supabase_rest_carelink'])

    def test_wrong_versions_and_untrusted_registries_fail_closed(self):
        for image in ['ghcr.io/supabase/postgrest:v14.12', 'postgrest/postgrest:v14.12', 'other.invalid/supabase/postgrest:v14.15', 'ghcr.io/other/postgrest:v14.15']:
            with self.subTest(image=image), self.inspect(self.info(image)):
                with self.assertRaises(wire.VerificationError):
                    wire.local_target()

    def test_another_container_or_public_destination_is_rejected(self):
        another = self.info()
        another['Name'] = '/supabase_rest_other_project'
        stopped = self.info()
        stopped['State']['Running'] = False
        for info in [another, stopped, self.info(address='203.0.113.1')]:
            with self.subTest(info=info), self.inspect(info):
                with self.assertRaises(wire.VerificationError):
                    wire.local_target()

    def test_external_destination_arguments_are_rejected_before_docker(self):
        with mock.patch.object(wire.sys, 'argv', ['probe', 'https://hosted.invalid']), mock.patch.object(wire.subprocess, 'check_output') as inspect:
            with self.assertRaises(wire.VerificationError):
                wire.main()
            inspect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
