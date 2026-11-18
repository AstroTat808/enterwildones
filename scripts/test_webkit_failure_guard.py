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

    def test_touch_only_mobile_webkit_scroll_avoids_mouse_wheel(self):
        class TouchOnlyPage:
            def __init__(self):
                self.position = 0
                self.mouse = self

            def wheel(self, *args):
                raise AssertionError("Mouse.wheel must never run in mobile WebKit")

            def evaluate(self, expression, *args):
                if expression.startswith("top=>"):
                    self.position = int(args[0])
                if expression == "window.scrollY":
                    return self.position

            def wait_for_timeout(self, milliseconds):
                pass

        for width in (320, 390, 430, 768):
            with self.subTest(width=width):
                page = TouchOnlyPage()
                offset = AUDIT["scroll_guest_masthead"](page, "webkit", width, 1800)
                self.assertGreater(offset, 72)
                self.assertEqual(offset, page.position)

    def test_desktop_wheel_falls_back_to_real_scroll_when_needed(self):
        class DesktopPage:
            def __init__(self):
                self.mouse = self
                self.position = 0
                self.wheel_calls = 0

            def wheel(self, dx, dy):
                self.wheel_calls += 1

            def evaluate(self, expression, *args):
                if expression.startswith("top=>"):
                    self.position = int(args[0])
                if expression == "window.scrollY":
                    return self.position

            def wait_for_timeout(self, milliseconds):
                pass

        page = DesktopPage()
        offset = AUDIT["scroll_guest_masthead"](page, "webkit", 1024, 1800)
        self.assertEqual(page.wheel_calls, 1)
        self.assertGreater(offset, 72)

    def test_guest_masthead_recovers_from_suppressed_mobile_webkit_scroll_events(self):
        source = (SRC.parents[1] / "site/assets/js/branding.js").read_text(encoding="utf-8")
        self.assertIn("window.addEventListener('scroll',schedule,{passive:true})", source)
        self.assertIn("document.addEventListener('scroll',schedule,{passive:true,capture:true})", source)
        self.assertIn("document.scrollingElement||document.documentElement", source)
        self.assertIn("window.scrollY||0", source)
        self.assertIn("setInterval(()=>{if(!document.hidden)apply();},250)", source)
        self.assertIn("document.body.classList.contains('masthead-scrolled')!==compact", source)
        self.assertIn("window.addEventListener('pagehide',()=>clearInterval(recovery)", source)
        self.assertIn("if(top>2)observedPhysicalScroll=true", source)
        self.assertIn("if(!observedPhysicalScroll && !compact)return", source)
        self.assertIn("if(top<=2)observedPhysicalScroll=false", source)

    def test_webkit_masthead_requires_actual_scroll_class(self):
        source = SRC.read_text(encoding="utf-8")
        self.assertIn("page.mouse.wheel(0,top)", source)
        self.assertIn('if browser_name=="webkit" and width<900:', source)
        self.assertIn('page.evaluate("top=>window.scrollTo({top,behavior:\'auto\'})",top)', source)
        self.assertIn('page.touchscreen.tap(hit["x"],hit["y"])', source)
        self.assertIn('document.elementFromPoint(x,y)', source)
        self.assertIn('page.locator("details.mobile-menu[open] nav a:visible").count()>0', source)
        self.assertNotIn('s.tap(timeout=10000)', source)
        self.assertIn("page.on(\"crash\"", source)
        self.assertIn('full_page=(browser_name!="webkit")', source)
        self.assertNotIn("page.mouse.wheel(0,min(220,max_scroll))", source)
        self.assertIn("page.locator('body.masthead-scrolled').wait_for", source)
        self.assertIn("if max_scroll>90:", source)
        self.assertIn("WEBKIT_FAIL_FAST", source)
        self.assertIn("WEBKIT_CLEANUP_TIMEOUT", source)
        self.assertIn("os._exit(1)", source)


if __name__ == "__main__":
    unittest.main()
