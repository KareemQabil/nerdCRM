#!/usr/bin/env python3
"""Anonymous-only HTTPS smoke for owner-operated private IOETI staging. No mutations."""
from __future__ import annotations
import argparse
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def fetch(url: str) -> tuple[int, dict[str, str], bytes]:
    opener = urllib.request.build_opener(NoRedirect())
    req = urllib.request.Request(url, headers={"Accept": "application/json, text/html;q=0.8",
                                               "User-Agent": "IOETI-staging-smoke/1.0"})
    try:
        with opener.open(req, timeout=12) as response:
            return response.status, dict(response.headers.items()), response.read(150_000)
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), error.read(2_000)

def verify(origin: str) -> list[str]:
    parts = urlsplit(origin)
    if (parts.scheme != "https" or not parts.hostname or parts.username or parts.password
            or parts.path not in ("", "/") or parts.query or parts.fragment):
        raise ValueError("Expected only an HTTPS staging origin with no path or credentials")
    root = origin.rstrip("/")
    errors: list[str] = []
    try:
        status, headers, payload = fetch(root + "/")
        if status != 200 or b'<div id="root"' not in payload:
            errors.append("React shell was not served: HTTP " + str(status))
        for name, expected in (("x-content-type-options", "nosniff"), ("x-frame-options", "DENY")):
            observed = next((value for key, value in headers.items() if key.lower() == name), None)
            if observed != expected:
                errors.append("Invalid/missing security response header: " + name)
        for path in ("/axelor-erp/ws/ioeti/session",
                     "/axelor-erp/ws/ioeti/business-lines",
                     "/axelor-erp/ws/ioeti/security/identity-boundary"):
            result, response_headers, _ = fetch(root + path)
            if result not in (401, 403):
                errors.append("Anonymous " + path + " returned " + str(result) + ", expected 401/403")
            for key, cookie in response_headers.items():
                if (key.lower() == "set-cookie" and
                        ("jsessionid" in cookie.lower() or "csrf-token" in cookie.lower()) and
                        "secure" not in cookie.lower()):
                    errors.append("Session or CSRF cookie missing Secure flag")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        errors.append("Unreachable staging endpoint or invalid TLS certificate: " + str(error))
    return errors

def main() -> int:
    parser = argparse.ArgumentParser(description="Anonymous HTTPS staging smoke (no credentials)")
    parser.add_argument("origin", help="https://actual-staging-hostname")
    args = parser.parse_args()
    try:
        failures = verify(args.origin)
    except ValueError as error:
        failures = [str(error)]
    for failure in failures:
        print("FAIL: " + failure, file=sys.stderr)
    if failures:
        return 1
    print("PASS: HTTPS UI shell, security headers and anonymous endpoint denials")
    print("This is not UAT, session security testing or a production approval.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
