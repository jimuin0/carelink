import importlib.util
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


if __name__ == '__main__':
    unittest.main()
