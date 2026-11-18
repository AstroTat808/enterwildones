"""Guard exact PR candidate-site routes required for responsive Turnstile QA."""
import unittest

from production_visual_qa import SUITES
from serve_pr_visual_qa import ROUTES, SITE


class PreviewTurnstileRoutesTest(unittest.TestCase):
    def test_turnstile_form_cases_resolve_to_real_documents(self):
        expected = {
            "passport-login": ("/passport", "passport.html"),
            "public-tickets": ("/public-tickets/sunveil", "public-tickets.html"),
            "apply-aureva": ("/apply/aureva", "apply.html"),
        }
        cases = {case.name: case for suite in SUITES.values() for case in suite}
        for name, (url, filename) in expected.items():
            with self.subTest(case=name):
                self.assertIn(name, cases)
                self.assertEqual(cases[name].path.split("?", 1)[0], url)
                self.assertEqual(ROUTES.get(url), filename)
                self.assertTrue((SITE / filename).is_file())


if __name__ == "__main__":
    unittest.main()
