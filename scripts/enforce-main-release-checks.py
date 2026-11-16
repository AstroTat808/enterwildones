#!/usr/bin/env python3
"""Audit and, with an admin token, enforce the existing EWO main ruleset.

Run without arguments to audit (read-only); --apply requires explicit confirmation.
GH_TOKEN/GITHUB_TOKEN must have repository Administration:write to change rulesets.
Never paste a token into the shell command, code, issues, PRs, or this chat.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

REPO = "AstroTat808/enterwildones"
RULESET_ID = 23566095
ACTIONS_APP_ID = 15368
ENDPOINT = f"https://api.github.com/repos/{REPO}/rulesets/{RULESET_ID}"
REQUIRED = (
    "build",
    "certify",
    "Production QA Gate",
    "Release Certification",
    "Approved screenshot regression",
    "Lighthouse + Core Web Vitals gate",
    "Masthead · webkit",
    "Masthead · chromium",
    "Release · Payment Tests",
    "Release · Security Source Audit",
)
MANDATORY_RULES = {"deletion", "non_fast_forward", "pull_request", "required_status_checks"}


def check(current):
    if current.get("id") != RULESET_ID or current.get("target") != "branch":
        raise ValueError("Unexpected GitHub ruleset; refusing unsafe update")
    if current.get("enforcement") != "active":
        raise ValueError("Existing ruleset must already be actively enforced")
    branches = current.get("conditions", {}).get("ref_name", {}).get("include", [])
    if "~DEFAULT_BRANCH" not in branches:
        raise ValueError("Current ruleset does not protect the default branch")
    by_type = {r.get("type"): r for r in current.get("rules", [])}
    if not MANDATORY_RULES.issubset(by_type):
        raise ValueError("Existing pull-request / force-push / deletion guards are missing")
    params = by_type["required_status_checks"].get("parameters", {})
    configured = {c["context"]: c.get("integration_id")
                  for c in params.get("required_status_checks", [])}
    missing = [n for n in REQUIRED if configured.get(n) != ACTIONS_APP_ID]
    strict = params.get("strict_required_status_checks_policy") is True
    return {"required": list(REQUIRED), "missing_or_wrong_source": missing,
            "strict": strict, "enforced": not missing and strict}


def proposed(current):
    check(current)
    output = {k: current[k] for k in
              ("name", "target", "enforcement", "conditions", "bypass_actors")
              if k in current}
    output["rules"] = [dict(r) for r in current["rules"]]
    required_rule = next(r for r in output["rules"]
                         if r["type"] == "required_status_checks")
    params = dict(required_rule.get("parameters", {}))
    existing = {c["context"]: dict(c)
                for c in params.get("required_status_checks", [])}
    for name in REQUIRED:
        existing[name] = {"context": name, "integration_id": ACTIONS_APP_ID}
    params["required_status_checks"] = list(existing.values())
    params["strict_required_status_checks_policy"] = True
    required_rule["parameters"] = params
    return output


def api(method, token=None, payload=None):
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "EWO-release-protection-audit",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        headers["Content-Type"] = "application/json"
    encoded = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(ENDPOINT, data=encoded, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"GitHub {method} failed (HTTP {err.code}); check admin access") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--verify", action="store_true", help="Fail if required checks not enforced")
    group.add_argument("--apply", action="store_true", help="Update existing ruleset; requires admin token")
    parser.add_argument("--confirm", default="", help="Required with --apply: ENFORCE-CHECKS")
    args = parser.parse_args()
    token = os.getenv("GH_TOKEN") or os.getenv("GITHUB_TOKEN")
    try:
        before = api("GET", token)
        status = check(before)
        print(json.dumps(status, indent=2))
        if args.verify:
            return 0 if status["enforced"] else 2
        if not args.apply:
            print("Read-only audit. Nothing changed.")
            return 0
        if args.confirm != "ENFORCE-CHECKS" or not token:
            print("--apply requires --confirm ENFORCE-CHECKS and an Admin:write token",
                  file=sys.stderr)
            return 2
        latest = api("GET", token)
        if latest.get("updated_at") != before.get("updated_at"):
            raise ValueError("Ruleset changed since audit; aborting")
        api("PUT", token, proposed(latest))
        verified = check(api("GET", token))
        if not verified["enforced"]:
            print("Ruleset update did not verify", file=sys.stderr)
            return 4
        print("Verified: all mandatory checks required from GitHub Actions.")
        return 0
    except (ValueError, RuntimeError) as err:
        print(err, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
