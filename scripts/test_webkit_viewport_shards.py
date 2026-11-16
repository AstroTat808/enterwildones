#!/usr/bin/env python3
"""Require complete, non-overlapping responsive WebKit coverage in all four shards."""
import runpy
import unittest
from collections import Counter
from pathlib import Path

QA = runpy.run_path(str(Path(__file__).resolve().with_name("production_visual_qa.py")))
GROUPS = QA["VIEWPORTS"]
SUITES = QA["SUITES"]
select = QA["viewport_groups"]


class WebKitShardContract(unittest.TestCase):
    def test_all_existing_viewports_in_exactly_one_shard(self):
        original = GROUPS["webkit"]
        selected = [view for group in "0123" for view in select("webkit", group)]
        self.assertEqual(len(selected), len(original))
        self.assertEqual(Counter(selected), Counter(original))
        self.assertEqual(len(set(selected)), len(original))

    def test_each_shard_has_two_full_viewport_specs(self):
        for group in "0123":
            with self.subTest(group=group):
                self.assertEqual(len(select("webkit", group)), 2)
                self.assertEqual(len({v[0] for v in select("webkit", group)}), 2)

    def test_existing_suite_and_case_cross_product_preserved(self):
        for suite in ("public", "transactional", "admin"):
            with self.subTest(suite=suite):
                all_cases = {(vp[0], case.name)
                             for vp in GROUPS["webkit"] for case in SUITES[suite]}
                sharded = [(vp[0], case.name)
                           for group in "0123"
                           for vp in select("webkit", group)
                           for case in SUITES[suite]]
                self.assertEqual(set(sharded), all_cases)
                self.assertEqual(len(sharded), len(all_cases))

    def test_unsplit_staff_and_chromium_unchanged(self):
        self.assertEqual(select("webkit", "all"), GROUPS["webkit"])
        self.assertEqual(select("chromium", "all"), GROUPS["chromium"])
        self.assertEqual(len(SUITES["staff"]), 2)

    def test_rejects_unsupported_shards(self):
        for browser, group in [("webkit", "4"), ("webkit", ""), ("chromium", "0")]:
            with self.subTest(browser=browser, group=group), self.assertRaises(ValueError):
                select(browser, group)


if __name__ == "__main__":
    unittest.main()
