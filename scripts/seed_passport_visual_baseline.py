#!/usr/bin/env python3
"""Migrate v15 screenshots using only the reviewed Passport reference commit.

The candidate never supplies its own approved screenshots. Unrelated screenshots
are copied byte for byte from v15, or captured from the fixed pre-PR main commit
when that cache has expired. This module's guards use only the standard library
so the source-audit job can test them without installing a browser.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading


PREVIOUS_BASELINE_KEY = "enterwildones-approved-visual-baseline-v15-turnstile"
FALLBACK_BASE_SHA = "868310a3e7cf1f2f64c60109b435dda86e3183b6"
APPROVED_PASSPORT_CASES = frozenset({
    "passport-auth-desktop",
    *(
        f"passport-{state}-{width}"
        for state in ("redeemed-locked", "redeemed-eligible", "purchased")
        for width in (320, 390, 430, 768, 1440)
    ),
})


def require_commit_sha(value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("An immutable, full lowercase commit SHA is required.")
    return value


def validate_scope(cases, approved=APPROVED_PASSPORT_CASES):
    """Reject broad approvals, misspelled cases, and incomplete case registries."""
    approved = frozenset(approved)
    outside = approved - APPROVED_PASSPORT_CASES
    if outside:
        raise ValueError("Outside reviewed Passport scope: " + ", ".join(sorted(outside)))
    if approved != APPROVED_PASSPORT_CASES:
        raise ValueError("All 16 reviewed Passport cases must be included.")
    names = [case["name"] for case in cases]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate screenshot case names are not allowed.")
    if any(not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) for name in names):
        raise ValueError("Invalid screenshot case name.")
    unknown = approved - set(names)
    if unknown:
        raise ValueError("Unknown approved cases: " + ", ".join(sorted(unknown)))
    return names


def verify_reference_site(site: Path, expected_sha: str) -> Path:
    """Require an unchanged, separately checked-out site at the reviewed SHA."""
    expected_sha = require_commit_sha(expected_sha)
    site = site.resolve()
    if not site.is_dir() or site.name != "site":
        raise ValueError("Reference must be an existing checkout's site directory.")

    def git(*arguments):
        return subprocess.check_output(
            ["git", "-C", str(site.parent), *arguments], text=True
        ).strip()

    if Path(git("rev-parse", "--show-toplevel")).resolve() != site.parent:
        raise ValueError("Reference site must belong to its own checkout.")
    if git("rev-parse", "HEAD") != expected_sha:
        raise ValueError("Reference checkout does not match its reviewed commit.")
    if git("status", "--porcelain", "--untracked-files=all", "--", "site"):
        raise ValueError("Reference site has unreviewed working-tree changes.")
    return site


def image_digest(path: Path) -> str:
    if not path.is_file() or path.is_symlink():
        raise ValueError("Missing baseline image: " + str(path))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compose_baseline(
    target: Path,
    previous: Path,
    reviewed: Path,
    cases,
    approved_sha: str,
    previous_source: str = "approved-v15",
    approved=APPROVED_PASSPORT_CASES,
):
    """Copy validated inputs atomically; never overwrite an existing baseline."""
    approved_sha = require_commit_sha(approved_sha)
    names = validate_scope(cases, approved)
    if previous_source not in ("approved-v15", "pinned-base"):
        raise ValueError("Unknown prior baseline source.")
    target, previous, reviewed = map(lambda path: path.resolve(), (target, previous, reviewed))
    if target.exists():
        raise ValueError("Refusing to overwrite an existing approved baseline.")
    if target == previous or target == reviewed:
        raise ValueError("Baseline output must be separate from its references.")
    sources = []
    for name in names:
        is_approved = name in approved
        source = (reviewed if is_approved else previous) / (name + ".png")
        sources.append((name, source, {
            "name": name,
            "source": "reviewed-passport" if is_approved else previous_source,
            "sha256": image_digest(source),
        }))
    manifest = {
        "schemaVersion": 1,
        "approvedPassportSha": approved_sha,
        "fallbackBaseSha": FALLBACK_BASE_SHA,
        "previousBaselineKey": PREVIOUS_BASELINE_KEY,
        "approvedCases": sorted(approved),
        "cases": [record for _, _, record in sources],
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".passport-baseline-", dir=target.parent) as temporary:
        assembled = Path(temporary) / "baseline"
        assembled.mkdir()
        for name, source, _ in sources:
            shutil.copy2(source, assembled / (name + ".png"))
        (assembled / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        assembled.rename(target)
    return manifest


def verify_baseline(baseline: Path, cases, approved_sha: str):
    """Validate restored cache provenance and every case before comparison."""
    approved_sha = require_commit_sha(approved_sha)
    names = validate_scope(cases)
    manifest = json.loads((baseline / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unknown Passport baseline manifest version.")
    if manifest.get("approvedPassportSha") != approved_sha:
        raise ValueError("Cached Passport baseline belongs to another approval commit.")
    if manifest.get("fallbackBaseSha") != FALLBACK_BASE_SHA:
        raise ValueError("Cached baseline changed the fixed pre-PR reference.")
    if manifest.get("previousBaselineKey") != PREVIOUS_BASELINE_KEY:
        raise ValueError("Cached baseline changed the previous approval source.")
    if manifest.get("approvedCases") != sorted(APPROVED_PASSPORT_CASES):
        raise ValueError("Cached baseline approval scope does not match the reviewed cases.")
    records = manifest.get("cases", [])
    if len(records) != len(names) or {record["name"] for record in records} != set(names):
        raise ValueError("Cached baseline has unknown, duplicate, or missing cases.")
    for record in records:
        name = record["name"]
        expected = {"reviewed-passport"} if name in APPROVED_PASSPORT_CASES else {"approved-v15", "pinned-base"}
        if record.get("source") not in expected:
            raise ValueError("Unapproved screenshot source for " + name)
        if image_digest(baseline / (name + ".png")) != record.get("sha256"):
            raise ValueError("Cached baseline image changed: " + name)
    return manifest


@contextmanager
def reference_server(visual, site: Path):
    """Reuse the visual harness's route handling with an immutable source site."""
    original_site = visual.SITE
    visual.SITE = site
    server = None
    worker = None
    try:
        server = visual.ThreadingHTTPServer(("127.0.0.1", 0), visual.Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
        if worker is not None:
            worker.join(timeout=5)
        visual.SITE = original_site


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", default=".visual-baselines")
    parser.add_argument("--previous-baseline-dir", default=".visual-baselines-v15")
    parser.add_argument("--approved-reference-site")
    parser.add_argument("--fallback-reference-site")
    parser.add_argument("--approved-sha", required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    approved_sha = require_commit_sha(args.approved_sha)
    import visual_regression as visual

    validate_scope(visual.CASES)
    target = Path(args.baseline_dir)
    if args.verify_only:
        manifest = verify_baseline(target, visual.CASES, approved_sha)
        visual.OUT.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target / "manifest.json", visual.OUT / "passport-baseline-manifest.json")
        print(json.dumps({"verifiedCases": len(manifest["cases"]), "approvedPassportSha": approved_sha}))
        return 0
    if not args.approved_reference_site:
        parser.error("--approved-reference-site is required when creating a baseline")
    approved_site = verify_reference_site(Path(args.approved_reference_site), approved_sha)
    previous = Path(args.previous_baseline_dir)
    previous_source = "approved-v15"
    visual.OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="passport-reference-", dir=visual.OUT) as temporary:
        temporary = Path(temporary)
        if not previous.exists():
            if not args.fallback_reference_site:
                parser.error("The v15 cache or --fallback-reference-site is required")
            base_site = verify_reference_site(Path(args.fallback_reference_site), FALLBACK_BASE_SHA)
            previous = temporary / "fixed-base"
            previous_source = "pinned-base"
            unchanged = [case for case in visual.CASES if case["name"] not in APPROVED_PASSPORT_CASES]
            with reference_server(visual, base_site) as base_url:
                visual.capture(base_url, previous, cases=unchanged)
        elif not previous.is_dir():
            raise ValueError("Previous baseline must be a directory.")
        reviewed = temporary / "reviewed-passport"
        selected = [case for case in visual.CASES if case["name"] in APPROVED_PASSPORT_CASES]
        with reference_server(visual, approved_site) as base_url:
            visual.capture(base_url, reviewed, cases=selected)
        manifest = compose_baseline(target, previous, reviewed, visual.CASES, approved_sha, previous_source)
    verify_baseline(target, visual.CASES, approved_sha)
    shutil.copy2(target / "manifest.json", visual.OUT / "passport-baseline-manifest.json")
    print(json.dumps({
        "seeded": len(manifest["cases"]),
        "reviewedPassportCases": sorted(APPROVED_PASSPORT_CASES),
        "approvedPassportSha": approved_sha,
        "unchangedSource": previous_source,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
