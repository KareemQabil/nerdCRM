"""Minimal RFC 6455 WebSocket client for the live probes (text frames only, no dependencies).

Native clients send no Origin header; AOP's WebSocketConfigurator allows that (CSRF does not apply).
"""
import base64
import json
import os
import socket
import struct
import urllib.parse


class WebSocket:
    def __init__(self, url, cookie_header, timeout=30):
        parts = urllib.parse.urlparse(url)
        self.sock = socket.create_connection((parts.hostname, parts.port or 80), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (f"GET {parts.path} HTTP/1.1\r\nHost: {parts.hostname}:{parts.port or 80}\r\n"
                   f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                   f"Sec-WebSocket-Version: 13\r\nCookie: {cookie_header}\r\n\r\n")
        self.sock.sendall(request.encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1)
            if not chunk:
                raise ConnectionError("handshake closed")
            head += chunk
        self.status = int(head.split(b" ", 2)[1])
        if self.status != 101:
            raise ConnectionError(f"handshake refused: HTTP {self.status}")

    def _recv_exact(self, n):
        data = b""
        while len(data) < n:
            chunk = self.sock.recv(n - len(data))
            if not chunk:
                raise ConnectionError("connection closed")
            data += chunk
        return data

    def send_json(self, payload):
        data = json.dumps(payload).encode()
        header = bytearray([0x81])  # FIN + text
        if len(data) < 126:
            header.append(0x80 | len(data))
        elif len(data) < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", len(data))
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", len(data))
        mask = os.urandom(4)
        self.sock.sendall(bytes(header) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv_json(self):
        """Next text message as JSON; answers pings; None when the server closes."""
        while True:
            b1, b2 = self._recv_exact(2)
            opcode, length = b1 & 0x0F, b2 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._recv_exact(8))[0]
            payload = self._recv_exact(length)
            if opcode == 0x8:
                return None
            if opcode == 0x9:  # ping → pong
                self.sock.sendall(bytes([0x8A, 0x80]) + os.urandom(4))
                continue
            if opcode == 0x1:
                return json.loads(payload.decode())

    def close(self):
        try:
            self.sock.sendall(bytes([0x88, 0x80]) + os.urandom(4))
        except OSError:
            pass
        self.sock.close()


def cookie_header(client):
    """The Cookie header of an api_smoke_test.Client session."""
    import urllib.request
    for handler in client.opener.handlers:
        if isinstance(handler, urllib.request.HTTPCookieProcessor):
            return "; ".join(f"{c.name}={c.value}" for c in handler.cookiejar)
    return ""
