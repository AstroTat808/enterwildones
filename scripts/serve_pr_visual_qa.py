#!/usr/bin/env python3
"""Serve the exact checked-out PR site for pre-merge Playwright QA.

No Netlify functions, secrets, Stripe calls, or production ticket records are
used. API responses in these cases are intercepted by the browser fixtures.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import argparse
import json

SITE = (Path(__file__).resolve().parents[1] / "site").resolve()
ROUTES = {
    "/": "index.html",
    "/passport": "passport.html",
    "/admin": "admin.html",
}

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        # The local pre-merge server has no Netlify functions. Serve the exact
        # mock event-summary contract expected by the homepage hydration script
        # instead of generating a spurious browser-console 404.
        pathname = urlparse(self.path).path
        if pathname == "/api/events":
            payload = {
                "cycle": {"name": "The Wild Ones Cycle", "statement": "Four realms. One cycle."},
                "events": [
                    {"eventId": "aureva-2026", "slug": "aureva", "startsAt": "2027-01-23T19:00:00-10:00", "status": "upcoming", "ticketSalesOpen": False, "applicationOpen": True, "accessMode": "invitation"},
                    {"eventId": "halora-2027", "slug": "halora", "startsAt": "2027-04-01T19:00:00-10:00", "status": "coming_soon", "ticketSalesOpen": False, "applicationOpen": False, "accessMode": "invitation"},
                    {"eventId": "sunveil-2027", "slug": "sunveil", "startsAt": "2027-07-01T19:00:00-10:00", "status": "coming_soon", "ticketSalesOpen": False, "applicationOpen": False, "accessMode": "public"},
                    {"eventId": "nocturne-2027", "slug": "nocturne", "startsAt": "2027-09-01T19:00:00-10:00", "status": "coming_soon", "ticketSalesOpen": False, "applicationOpen": False, "accessMode": "invitation"}
                ]
            }
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

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
