#!/usr/bin/env python3
"""Validate WebKit cleanup watchdog and non-weakened interactive masthead contract."""
import runpy
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SRC = Path(__file__).resolve().with_name("production_visual_qa.py")
AUDIT = runpy.run_path(str(SRC))


class WebKitCleanups(unittest.TestCase):
    def test_webkit_cleanup_success_path(self):
        with TemporaryDirectory() as root:
            calls = []
            AUDIT["guarded_browser_cleanup"](
                lambda: calls.append("closed"), Path(root), "sample-case", "webkit"
            )
            self.assertEqual(calls, ["closed"])
            self.assertFalse((Path(root)/"cleanup-timeout.json").exists())

    def test_chromium_cleanup_path_unchanged(self):
        with TemporaryDirectory() as root:
            calls = []
            AUDIT["guarded_browser_cleanup"](
                lambda: calls.append("closed"), Path(root), "sample-case", "chromium"
            )
            self.assertEqual(calls, ["closed"])

    def test_webkit_masthead_requires_actual_scroll_class(self):
        source = SRC.read_text(encoding="utf-8")
        self.assertIn("page.mouse.wheel(0,min(220,max_scroll))", source)
        self.assertIn("page.locator('body.masthead-scrolled').wait_for", source)
        self.assertIn("if max_scroll>90:", source)
        self.assertIn("WEBKIT_FAIL_FAST", source)
        self.assertIn("WEBKIT_CLEANUP_TIMEOUT", source)
        self.assertIn("os._exit(1)", source)


if __name__ == "__main__":
    unittest.main()
