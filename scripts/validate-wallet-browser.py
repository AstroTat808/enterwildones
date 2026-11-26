"""Local static wallet QA with synthetic account data only; never contacts Stripe or Google."""
import base64
import functools
import json
import pathlib
import threading
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "wallet-visual-results"
OUT.mkdir(exist_ok=True)
TICKET = "WLD-AUR-TKT-1234567890ABCDEF"
# Valid image for UI/cache testing, deliberately not a usable admission QR.
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVf8AAAAASUVORK5CYII="
EXP = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
state = {"signed": True, "authenticated": True}
def fixture():
    realms=[]
    for realm, name, slug in [("light","AUREVA","aureva"),("balance","HALORA","halora"),("fire","SUNVEIL","sunveil"),("night","NOCTURNE","nocturne")]:
        x={"event":{"realm":realm,"name":name,"eventId":"aureva-2026" if realm=="light" else slug+"-2027","startsAt":"2027-01-23T19:00:00-10:00","timezone":"Pacific/Honolulu","copy":{"eyebrow":"REALM · "+realm.upper()}},"checkedIn":realm=="balance","waiverSigned":False,"googleWalletAvailable":False,"entitlements":[]}
        if realm=="light":
            x.update(ticket={"ticketId":TICKET,"status":"paid","ticketUrl":"/ticket?token=synthetic-test"},waiverSigned=state["signed"],entitlements=[{"addonType":"drink_package","status":"active","creditsPurchased":6,"creditsRemaining":4},{"addonType":"late_stay","status":"active","departureTime":"10:00 AM"}])
        realms.append(x)
    return {"authenticated":True,"user":{"userId":"wallet-browser-fixture"},"cycle":{"completed":1,"total":4,"complete":False},"realms":realms}
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
    def send_json(self, data, status=200):
        raw=json.dumps(data).encode()
        self.send_response(status);self.send_header("Content-Type","application/json");self.send_header("Cache-Control","no-store");self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        if self.path=="/api/passport":
            return self.send_json(fixture() if state["authenticated"] else {"authenticated":False},200 if state["authenticated"] else 401)
        return super().do_GET()
    def do_POST(self):
        if self.path!="/api/wallet/credential":return self.send_json({},404)
        body=json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if not state["authenticated"]:return self.send_json({"error":"Sign in"},401)
        if not state["signed"] or body!={"eventId":"aureva-2026","ticketId":TICKET,"action":"offline"}:return self.send_json({"error":"Waiver required"},403)
        return self.send_json({"ticketId":TICKET,"eventId":"aureva-2026","eventName":"AUREVA","realm":"light","expiresAt":EXP,"qr":PNG,"savedAt":datetime.now(timezone.utc).isoformat()})
server=ThreadingHTTPServer(("127.0.0.1",0),functools.partial(Handler,directory=str(ROOT/"site")))
threading.Thread(target=server.serve_forever,daemon=True).start()
base="http://127.0.0.1:"+str(server.server_port)
report=[]
try:
    with sync_playwright() as p:
        for engine in ["chromium","webkit"]:
            browser=getattr(p,engine).launch()
            for width,height in [(320,568),(390,844),(430,932),(768,1024),(1366,768),(1920,1080)]:
                state.update(signed=True,authenticated=True)
                ctx=browser.new_context(viewport={"width":width,"height":height},reduced_motion="reduce",device_scale_factor=1,is_mobile=width<500,has_touch=width<500)
                page=ctx.new_page();errors=[]
                page.on("pageerror",lambda err:errors.append(str(err)))
                page.goto(base+"/wallet/")
                expect(page.locator("#tickets article")).to_have_count(1)
                expect(page.locator("#realms article")).to_have_count(5)
                expect(page.locator(".credit-number")).to_have_text("4 / 6")
                expect(page.get_by_role("button",name="Add to Google Wallet")).to_have_count(0)
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth+1"),(engine,width,"overflow")
                page.wait_for_function("Array.from(document.querySelectorAll('.realm-art')).every(img=>img.complete&&img.naturalWidth>0)")
                page.screenshot(path=str(OUT/f"{engine}-{width}.png"),full_page=True,animations="disabled")
                assert not errors,errors
                if width==390:
                    # Real service-worker installation and offline navigation in Chromium.
                    if engine=="chromium":
                        page.wait_for_function("navigator.serviceWorker.controller !== null")
                        page.on("dialog",lambda dialog:dialog.accept())
                        page.get_by_role("button",name="Save QR offline").click()
                        expect(page.locator("#saved .qr")).to_be_visible()
                        ctx.set_offline(True)
                        page.reload(wait_until="domcontentloaded")
                        expect(page.locator("#saved .qr")).to_be_visible()
                        expect(page.locator("#tickets article")).to_have_count(0)
                        page.screenshot(path=str(OUT/"chromium-390-offline.png"),full_page=True,animations="disabled")
                        ctx.set_offline(False)
                        page.get_by_role("button",name="Refresh").click()
                        expect(page.locator("#tickets article")).to_have_count(1)
                    state["signed"]=False
                    page.get_by_role("button",name="Refresh").click()
                    expect(page.get_by_role("button",name="Save QR offline")).to_have_count(0)
                    expect(page.locator("#saved .qr")).to_have_count(0)
                    state["authenticated"]=False
                    page.get_by_role("button",name="Refresh").click()
                    expect(page.get_by_role("link",name="Sign in to Passport")).to_be_visible()
                    assert page.evaluate("!localStorage.getItem('wildones-wallet-offline-v1')")
                assert not errors,errors
                report.append({"browser":engine,"width":width,"result":"passed"})
                ctx.close()
            browser.close()
finally:
    server.shutdown()
    (OUT/"report.json").write_text(json.dumps(report,indent=2))
print(json.dumps(report))
