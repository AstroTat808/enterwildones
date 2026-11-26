"""Guard narrow Passport approval and preservation of unrelated screenshots."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from seed_passport_visual_baseline import (
    APPROVED_PASSPORT_CASES,
    compose_baseline,
    require_commit_sha,
    validate_scope,
    verify_baseline,
)


REVIEWED_SHA = "a" * 40


class PassportBaselineTest(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.previous = root / "v15"
        self.reviewed = root / "reviewed"
        self.target = root / "v16"
        self.previous.mkdir()
        self.reviewed.mkdir()
        self.names = sorted(APPROVED_PASSPORT_CASES) + ["home-desktop", "ticket-access-desktop"]
        self.cases = [{"name": name} for name in self.names]
        for name in self.names:
            (self.previous / (name + ".png")).write_bytes(("old:" + name).encode())
            (self.reviewed / (name + ".png")).write_bytes(("reviewed:" + name).encode())

    def compose(self, **kwargs):
        return compose_baseline(
            self.target, self.previous, self.reviewed, self.cases, REVIEWED_SHA, **kwargs
        )

    def test_only_the_16_reviewed_passport_images_can_change(self):
        manifest = self.compose()
        self.assertEqual(len(APPROVED_PASSPORT_CASES), 16)
        self.assertEqual(len(manifest["cases"]), len(self.cases))
        for name in self.names:
            source = self.reviewed if name in APPROVED_PASSPORT_CASES else self.previous
            self.assertEqual(
                (self.target / (name + ".png")).read_bytes(),
                (source / (name + ".png")).read_bytes(),
            )
        verify_baseline(self.target, self.cases, REVIEWED_SHA)

    def test_unrelated_approval_is_rejected_before_writing(self):
        with self.assertRaisesRegex(ValueError, "Outside reviewed Passport scope"):
            self.compose(approved=APPROVED_PASSPORT_CASES | {"home-desktop"})
        self.assertFalse(self.target.exists())

    def test_unknown_or_missing_approved_case_is_rejected(self):
        incomplete = [case for case in self.cases if case["name"] != "passport-purchased-320"]
        with self.assertRaisesRegex(ValueError, "Unknown approved cases"):
            validate_scope(incomplete)
        with self.assertRaisesRegex(ValueError, "All 16"):
            validate_scope(self.cases, APPROVED_PASSPORT_CASES - {"passport-auth-desktop"})

    def test_missing_reviewed_image_does_not_fall_back_to_old_image(self):
        (self.reviewed / "passport-purchased-320.png").unlink()
        with self.assertRaisesRegex(ValueError, "Missing baseline image"):
            self.compose()
        self.assertFalse(self.target.exists())

    def test_missing_old_image_does_not_accept_current_unrelated_image(self):
        (self.previous / "home-desktop.png").unlink()
        with self.assertRaisesRegex(ValueError, "Missing baseline image"):
            self.compose()
        self.assertFalse(self.target.exists())

    def test_new_unrelated_case_requires_its_own_existing_baseline(self):
        self.cases.append({"name": "unreviewed-new-route"})
        with self.assertRaisesRegex(ValueError, "Missing baseline image"):
            self.compose()
        self.assertFalse(self.target.exists())

    def test_duplicate_names_or_paths_cannot_escape_the_case_registry(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            validate_scope(self.cases + [self.cases[0]])
        with self.assertRaisesRegex(ValueError, "Invalid screenshot case name"):
            validate_scope(self.cases + [{"name": "../home-desktop"}])

    def test_mutable_reference_names_and_placeholder_are_rejected(self):
        for ref in ("main", "HEAD", "bd0b0c8", "REVIEWED_COMMIT_SHA_ROOT_WILL_REPLACE", "A" * 40):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                require_commit_sha(ref)
        self.assertEqual(require_commit_sha(REVIEWED_SHA), REVIEWED_SHA)

    def test_existing_baseline_is_never_overwritten(self):
        self.compose()
        before = (self.target / "manifest.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "Refusing to overwrite"):
            self.compose()
        self.assertEqual((self.target / "manifest.json").read_bytes(), before)

    def test_cache_with_another_approval_or_tampered_image_fails(self):
        self.compose()
        with self.assertRaisesRegex(ValueError, "another approval commit"):
            verify_baseline(self.target, self.cases, "b" * 40)
        (self.target / "home-desktop.png").write_bytes(b"changed after approval")
        with self.assertRaisesRegex(ValueError, "Cached baseline image changed"):
            verify_baseline(self.target, self.cases, REVIEWED_SHA)

    def test_cache_cannot_expand_approval_scope_or_reclassify_source(self):
        self.compose()
        path = self.target / "manifest.json"
        manifest = json.loads(path.read_text())
        manifest["approvedCases"].append("home-desktop")
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "approval scope"):
            verify_baseline(self.target, self.cases, REVIEWED_SHA)
        manifest["approvedCases"] = sorted(APPROVED_PASSPORT_CASES)
        for record in manifest["cases"]:
            if record["name"] == "home-desktop":
                record["source"] = "reviewed-passport"
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "Unapproved screenshot source"):
            verify_baseline(self.target, self.cases, REVIEWED_SHA)

    def test_fixed_base_fallback_keeps_the_same_narrow_scope(self):
        manifest = self.compose(previous_source="pinned-base")
        for record in manifest["cases"]:
            expected = "reviewed-passport" if record["name"] in APPROVED_PASSPORT_CASES else "pinned-base"
            self.assertEqual(record["source"], expected)
        verify_baseline(self.target, self.cases, REVIEWED_SHA)


if __name__ == "__main__":
    unittest.main()
