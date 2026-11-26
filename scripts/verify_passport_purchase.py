#!/usr/bin/env python3
"""Exercise authenticated purchase states against the exact checked-out UI.

Only local fixture responses are used; this never signs in or creates a payment.
"""
import argparse
import json
import threading
from http.server import ThreadingHTTPServer

from playwright.sync_api import sync_playwright, expect

import production_visual_qa as qa
import visual_regression as visual


def verify(base_url, browser_name):
    out = visual.OUT / ("passport-purchase-" + browser_name)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    with sync_playwright() as playwright:
        browser = getattr(playwright, browser_name).launch()
        for case in visual.PASSPORT_PURCHASE_CASES:
            width, height = case["viewport"]
            context = browser.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=case["dpr"], is_mobile=width < 900,
                has_touch=width < 900, color_scheme="dark", reduced_motion="reduce",
            )
            row = {"name": case["name"], "width": width, "issues": []}
            try:
                page = context.new_page()
                page.on("pageerror", lambda error: row["issues"].append(str(error)))
                qa.fixtures(page, case["state"])
                page.goto(base_url + "/passport", wait_until="domcontentloaded")
                expect(page.locator("#account")).to_be_visible()
                card = page.locator('[data-event-slug="aureva"]')
                expect(card).to_be_visible()
                card.scroll_into_view_if_needed()
                page.evaluate("document.fonts.ready")
                card.locator(".passport-card-logo").evaluate(
                    "async image => { if (!image.complete) await new Promise((resolve, reject) => { image.onload=resolve; image.onerror=reject; }); if (!image.naturalWidth) throw new Error('Credential artwork failed to load'); }"
                )
                purchased = case["state"] == "passport-purchased"
                eligible = case["state"] == "passport-redeemed-eligible"
                expect(card.locator(".passport-state")).to_have_text(
                    "TICKET PURCHASED" if purchased else "INVITATION REDEEMED"
                )
                expect(card.get_by_role("link", name="Explore the Realm")).to_have_attribute("href", "/events/aureva")
                purchase = card.get_by_role("button", name="Purchase AUREVA ticket")
                if purchased:
                    expect(purchase).to_have_count(0)
                    expect(card.get_by_role("link", name="Open Digital Ticket")).to_have_attribute("href", "/ticket?token=qa-jane")
                    expect(card.locator(".passport-entitlement-list em")).to_have_count(2)
                else:
                    expect(purchase).to_be_enabled() if eligible else expect(purchase).to_be_disabled()
                    expect(card.locator(".passport-purchase-message")).to_have_attribute("aria-live", "polite")
                    if not eligible:
                        expect(purchase).to_have_attribute("aria-describedby", "passport-purchase-help-aureva")
                        expect(card.locator(".passport-purchase-message")).to_contain_text("Your redeemed invitation is saved")
                        if purchase.get_attribute("data-purchase-event") is not None:
                            raise AssertionError("Locked purchase control must have no checkout handler")
                geometry = card.evaluate("""card => {
                    const box=card.getBoundingClientRect();
                    const controls=[...card.querySelectorAll('.passport-card-actions .button')].map(el=>{
                        const r=el.getBoundingClientRect();
                        return {left:r.left,right:r.right,width:r.width,height:r.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth};
                    });
                    return {left:box.left,right:box.right,width:box.width,
                        pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,controls};
                }""")
                row["geometry"] = geometry
                if geometry["pageWidth"] > width + 1 or geometry["left"] < -1 or geometry["right"] > width + 1:
                    raise AssertionError("Passport has horizontal overflow")
                for control in geometry["controls"]:
                    if control["height"] < 47.5 or control["width"] < 44:
                        raise AssertionError("Passport action misses touch-target minimum")
                    if control["left"] < geometry["left"] or control["right"] > geometry["right"] or control["scrollWidth"] > control["clientWidth"] + 1:
                        raise AssertionError("Passport action is clipped")
                shot = out / (case["name"] + ".png")
                card.screenshot(path=str(shot), animations="disabled", caret="hide")
                row["screenshot"] = str(shot)
                if eligible:
                    calls = []
                    def deny_access(route):
                        calls.append(route.request.method)
                        qa.fulfill(route, {"error":"Checkout is temporarily unavailable."}, 503)
                    page.route("**/api/passport/ticket-access", deny_access)
                    progress = page.locator("#progress").inner_text()
                    purchase.focus()
                    page.keyboard.press("Enter")
                    expect(card.locator(".passport-purchase-message")).to_have_text("Checkout is temporarily unavailable.")
                    expect(purchase).to_be_enabled()
                    expect(page.locator("#progress")).to_have_text(progress)
                    if calls != ["POST"]:
                        raise AssertionError("Keyboard purchase must issue one authenticated POST")
            except Exception as error:
                row["issues"].append(str(error))
            finally:
                context.close()
            rows.append(row)

        # A real browser lifecycle check: the guest keeps the same filtered tab
        # open while the API moves from invitation to a verified paid ticket.
        row = {"name":"payment-return-refresh", "issues":[]}
        context = browser.new_context(viewport={"width":390,"height":844}, reduced_motion="reduce")
        try:
            page = context.new_page()
            payload = qa.passport_purchase_fixture("redeemed-eligible")
            qa.fixtures(page, "plain")
            page.route("**/api/passport", lambda route: qa.fulfill(route, payload))
            page.goto(base_url + "/passport", wait_until="domcontentloaded")
            page.locator('#realmFilter button[data-realm="light"]').click()
            expect(page.locator('[data-event-slug="aureva"] .passport-state')).to_have_text("INVITATION REDEEMED")
            payload = qa.passport_purchase_fixture("purchased")
            page.evaluate("window.dispatchEvent(new Event('focus'))")
            expect(page.locator('[data-event-slug="aureva"] .passport-state')).to_have_text("TICKET PURCHASED", timeout=12000)
            expect(page.locator('#realmFilter button[data-realm="light"]')).to_have_attribute("aria-pressed", "true")
            expect(page.get_by_role("link", name="Open Digital Ticket")).to_be_visible()
            expect(page.get_by_role("button", name="Purchase AUREVA ticket")).to_have_count(0)
        except Exception as error:
            row["issues"].append(str(error))
        finally:
            context.close()
        rows.append(row)
        browser.close()
    result = {"browser":browser_name, "cases":len(rows), "rows":rows,
              "failures":[row for row in rows if row["issues"]]}
    (out / "report.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", choices=("chromium", "webkit"), required=True)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", 0), visual.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        result = verify(f"http://127.0.0.1:{server.server_address[1]}", args.browser)
        print(json.dumps({"browser":args.browser, "cases":result["cases"], "failures":result["failures"]}, indent=2))
        return int(bool(result["failures"]))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
