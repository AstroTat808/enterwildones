#!/usr/bin/env python3
"""Run the failing WebKit cases against THIS PR's static site, not production.

The real production browser matrix is a separate exact-deployed-SHA release gate.
This pre-merge test uses the existing route-aware local server and the exact
production browser assertions with fixture-backed APIs. It does not mutate data.
"""
import json
import os
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import production_visual_qa as qa
import visual_regression as vr

# Dates mirror the public event catalog, without opening ticket sales.
DATES = {
    "aureva":"2027-01-23T19:00:00-10:00",
    "halora":"2027-03-20T15:00:00-10:00",
    "sunveil":"2027-06-19T15:00:00-10:00",
    "nocturne":"2027-09-05T15:00:00-10:00",
}

CASES = (
    ("public", "home", "phone"),
    ("transactional", "passport-auth", "phone-large"),
    ("admin", "admin-overview", "phone-large"),
)


class PreviewHandler(vr.Handler):
    """Faithful local response for the otherwise unserved Netlify /api/events.

    This ONLY affects candidate-site smoke tests. The full published-SHA
    production matrix still tests the real public API with no mock.
    Unknown URLs and missing assets remain genuine HTTP 404s.
    """
    def do_GET(self):
        if urlparse(self.path).path == "/api/events":
            payload = {
                "cycle":{"name":"The Wild Ones Cycle","statement":"Four realms. One cycle."},
                "events":[
                    {
                        "eventId":entry["eventId"],
                        "slug":entry["slug"],
                        "startsAt":DATES[entry["slug"]],
                        "ticketSalesOpen":False,
                        "applicationOpen":entry["slug"]=="aureva",
                        "status":"announced" if entry["slug"]=="aureva" else "planned",
                        "accessMode":"application" if entry["slug"] in ("aureva","nocturne") else (
                            "application_then_public" if entry["slug"]=="halora" else "public"),
                    } for entry in qa.REALMS
                ],
            }
            body=json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type","application/json; charset=utf-8")
            self.send_header("Cache-Control","no-store")
            self.send_header("Content-Length",str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()


def main():
    qa.OUT = Path(os.getenv("VISUAL_RESULTS", "visual-results")) / "pr-preview-webkit"
    qa.OUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), PreviewHandler)
    runner = threading.Thread(target=server.serve_forever, daemon=True)
    runner.start()
    qa.BASE = f"http://127.0.0.1:{server.server_address[1]}"
    outcomes = []
    try:
        for suite, case, viewport in CASES:
            print(f"PREVIEW_WEBKIT_START suite={suite} case={case} viewport={viewport}", flush=True)
            # Identical assertions, desktop-mobile geometry, and menu behavior
            # as the production WebKit runner; includes reduced-motion checks.
            result = qa.browser_mode(
                suite, "webkit", "all", case_name=case, viewport_name=viewport
            )
            outcomes.append({"suite":suite,"case":case,"viewport":viewport,"status":result})
            if result != 0:
                break
        (qa.OUT / "preview-summary.json").write_text(
            json.dumps(outcomes, indent=2), encoding="utf-8"
        )
        return 1 if len(outcomes) != len(CASES) or any(x["status"] for x in outcomes) else 0
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
