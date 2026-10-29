import importlib.util
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("staging_smoke", ROOT / "scripts/staging_smoke.py")
smoke = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(smoke)
ORIGIN = "https://pilot.ioeti.test"

def safe_fetch(url):
    if url == ORIGIN + "/":
        return 200, {"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY"}, b'<div id="root"></div>'
    return 401, {"Set-Cookie": "JSESSIONID=test; Secure; HttpOnly; SameSite=Lax"}, b""

class StagingSmokeTests(unittest.TestCase):
    def test_private_staging_smoke_passes(self):
        with patch.object(smoke, "fetch", side_effect=safe_fetch) as caller:
            self.assertEqual(smoke.verify(ORIGIN), [])
            self.assertEqual(caller.call_count, 4)

    def test_leaked_anonymous_resource_fails(self):
        def leaky(url):
            if url.endswith("/business-lines"):
                return 200, {}, b'{"data":[{"secret":"never"}]}'
            return safe_fetch(url)
        with patch.object(smoke, "fetch", side_effect=leaky):
            self.assertTrue(any("business-lines" in text for text in smoke.verify(ORIGIN)))

    def test_insecure_session_cookie_fails(self):
        def insecure(url):
            status, headers, body = safe_fetch(url)
            if url.endswith("/session"):
                headers["Set-Cookie"] = "JSESSIONID=test; HttpOnly"
            return status, headers, body
        with patch.object(smoke, "fetch", side_effect=insecure):
            self.assertTrue(any("Secure" in text for text in smoke.verify(ORIGIN)))

    def test_missing_browser_headers_fails(self):
        def bad_headers(url):
            if url == ORIGIN + "/":
                return 200, {}, b'<div id="root"></div>'
            return safe_fetch(url)
        with patch.object(smoke, "fetch", side_effect=bad_headers):
            self.assertTrue(any("x-frame-options" in text for text in smoke.verify(ORIGIN)))

    def test_http_or_path_are_rejected_before_network(self):
        for origin in ("http://pilot.ioeti.test", "https://pilot.ioeti.test/admin"):
            with self.subTest(origin=origin):
                with patch.object(smoke, "fetch") as caller:
                    with self.assertRaises(ValueError):
                        smoke.verify(origin)
                    caller.assert_not_called()

    def test_network_or_certificate_error_fails(self):
        with patch.object(smoke, "fetch", side_effect=urllib.error.URLError("certificate verify failed")):
            self.assertTrue(any("certificate" in text for text in smoke.verify(ORIGIN)))

if __name__ == "__main__":
    unittest.main()
