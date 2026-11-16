"""Offline tests for the EWO ruleset enforcement command."""
import importlib.util
from pathlib import Path
import unittest


def load_script():
    p = Path(__file__).resolve().with_name("enforce-main-release-checks.py")
    spec = importlib.util.spec_from_file_location("ruleset_enforcer", p)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


m = load_script()


def fixture():
    return {
        "id": m.RULESET_ID,
        "name": "Basic Protection",
        "target": "branch",
        "enforcement": "active",
        "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
        "bypass_actors": [],
        "rules": [
            {"type": "deletion"},
            {"type": "non_fast_forward"},
            {"type": "pull_request", "parameters": {"required_approving_review_count": 0}},
            {"type": "required_status_checks", "parameters": {
                "strict_required_status_checks_policy": True,
                "do_not_enforce_on_create": False,
                "required_status_checks": [],
            }},
        ],
    }


class GitHubRulesetProtection(unittest.TestCase):
    def test_preserves_prior_rules_and_adds_all_checks(self):
        before = fixture()
        after = m.proposed(before)
        self.assertEqual(before["rules"][3]["parameters"]["required_status_checks"], [])
        self.assertEqual(before["conditions"], after["conditions"])
        self.assertEqual(before["bypass_actors"], after["bypass_actors"])
        self.assertEqual([r["type"] for r in before["rules"]], [r["type"] for r in after["rules"]])
        result = {**before, **after}
        self.assertTrue(m.check(result)["enforced"])

    def test_keeps_other_required_checks(self):
        before = fixture()
        before["rules"][3]["parameters"]["required_status_checks"] = [
            {"context": "Existing internal check", "integration_id": 12345}
        ]
        checks = m.proposed(before)["rules"][3]["parameters"]["required_status_checks"]
        self.assertEqual(len(checks), len(m.REQUIRED) + 1)
        self.assertIn({"context": "Existing internal check", "integration_id": 12345}, checks)

    def test_rejects_unprotected_branches(self):
        before = fixture()
        before["conditions"]["ref_name"]["include"] = ["refs/heads/staging"]
        with self.assertRaises(ValueError):
            m.proposed(before)

    def test_rejects_missing_force_push_guard(self):
        before = fixture()
        before["rules"] = [r for r in before["rules"] if r["type"] != "non_fast_forward"]
        with self.assertRaises(ValueError):
            m.proposed(before)


if __name__ == "__main__":
    unittest.main()
