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

import production_visual_qa as qa
import visual_regression as vr

CASES = (
    ("public", "home", "phone"),
    ("transactional", "passport-auth", "phone-large"),
    ("admin", "admin-overview", "phone-large"),
)


def main():
    qa.OUT = Path(os.getenv("VISUAL_RESULTS", "visual-results")) / "pr-preview-webkit"
    qa.OUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), vr.Handler)
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
