#!/usr/bin/env python3
"""Serve the exact checked-out PR site for pre-merge Playwright QA.

No Netlify functions, secrets, Stripe calls, or production ticket records are
used. API responses in these cases are intercepted by the browser fixtures.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import argparse

SITE = (Path(__file__).resolve().parents[1] / "site").resolve()
ROUTES = {
    "/": "index.html",
    "/passport": "passport.html",
    "/admin": "admin.html",
}

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def translate_path(self, path):
        pathname = urlparse(path).path
        relative = ROUTES.get(pathname, pathname.lstrip("/"))
        target = (SITE / relative).resolve()
        if target != SITE and SITE not in target.parents:
            return str(SITE / "__denied__")
        return str(target)

    def end_headers(self):
        # Match strict Netlify CSP rather than making local QA less restrictive.
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self' https: data: blob:; "
            "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https:; font-src 'self' data:; "
            "connect-src 'self' https://challenges.cloudflare.com; "
            "frame-src https://challenges.cloudflare.com; "
            "form-action 'self'; frame-ancestors 'none'; "
            "base-uri 'self'; object-src 'none'"
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("--port", type=int, default=8765)
    args = cli.parse_args()
    if not 1024 <= args.port <= 65535:
        raise ValueError("QA port must be nonprivileged")
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as httpd:
        print(f"PR visual QA serving {SITE} on 127.0.0.1:{args.port}", flush=True)
        httpd.serve_forever()
