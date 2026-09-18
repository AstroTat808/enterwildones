#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess, sys, time
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

BASE=os.environ.get("PRODUCTION_BASE_URL","https://enterwildones.com").rstrip("/")
OUT=Path(os.environ.get("VISUAL_RESULTS","visual-results"))
SITE=Path("site")

REALMS=[
 {"slug":"aureva","eventId":"aureva-2026","name":"AUREVA","realm":"light","year":2026,"accessMode":"invitation","minimumAge":18,"ticketSalesOpen":True,"copy":{"eyebrow":"REALM I · LIGHT","tagline":"Where the cycle begins in light."},"routes":{"event":"/events/aureva"}},
 {"slug":"halora","eventId":"halora-2027","name":"HALORA","realm":"balance","year":2027,"accessMode":"invitation","minimumAge":18,"ticketSalesOpen":True,"copy":{"eyebrow":"REALM II · BALANCE","tagline":"The equilibrium of opposites."},"routes":{"event":"/events/halora"}},
 {"slug":"sunveil","eventId":"sunveil-2027","name":"SUNVEIL","realm":"fire","year":2027,"accessMode":"public","minimumAge":18,"ticketSalesOpen":True,"copy":{"eyebrow":"REALM III · FIRE","tagline":"The realm where fire becomes becoming."},"routes":{"event":"/events/sunveil"}},
 {"slug":"nocturne","eventId":"nocturne-2027","name":"NOCTURNE","realm":"night","year":2027,"accessMode":"invitation","minimumAge":18,"ticketSalesOpen":True,"copy":{"eyebrow":"REALM IV · NIGHT","tagline":"The realm that begins after dark."},"routes":{"event":"/events/nocturne"}}
]

PASSPORT={"authenticated":True,"user":{"userId":"qa-user","preferredName":"Christopher","fullName":"Christopher Sibel"},"cycle":{"completed":2,"total":4},"realms":[
 {"event":REALMS[0],"checkedIn":True,"ticket":{"status":"checked_in","ticketId":"WLD-AUR-QA-1","ticketUrl":"/ticket?token=qa-aureva"},"waiverSigned":True,"entitlements":[{"status":"active","addonType":"drink_package"}],"purchaseAvailable":False},
 {"event":REALMS[1],"checkedIn":False,"ticket":{"status":"paid","ticketId":"WLD-HAL-QA-2","ticketUrl":"/ticket?token=qa-halora"},"waiverSigned":True,"entitlements":[{"status":"active","addonType":"late_stay"}],"purchaseAvailable":False},
 {"event":REALMS[2],"checkedIn":False,"application":{"status":"approved"},"waiverSigned":False,"entitlements":[],"purchaseAvailable":True},
 {"event":REALMS[3],"checkedIn":False,"waiverSigned":False,"entitlements":[],"purchaseAvailable":False}
]}

APPS=[
 {"applicationId":"qa-app-1","status":"pending","fullName":"Rehearsal Guest","preferredName":"Rehearsal","email":"qa@example.com","phone":"8085550101","location":"Hawaii Island","instagram":"@wildonesqa","referral":"Wild Ones","community":"Music and arts","whyAttend":"Validate the guest journey.","groupNames":"QA Crew","conductAck":True,"selectionAck":True,"privacyAck":True,"createdAt":"2026-09-17T12:00:00-10:00"},
 {"applicationId":"qa-app-2","status":"approved","fullName":"Approved Guest","preferredName":"Approved","email":"approved@example.com","phone":"8085550102","location":"Hilo","instagram":"@approvedguest","createdAt":"2026-09-16T12:00:00-10:00","invitationId":"qa-invite-2","invitationEmailSentAt":"2026-09-16T13:00:00-10:00"}
]
ADMIN_APPS={"event":REALMS[0],"events":REALMS,"applications":APPS}
OVERVIEW={"totals":{"applications":145,"approved":97,"tickets":82,"checkedIn":31,"admissionRevenueCents":287500,"addonRevenueCents":84200,"drinkCreditsRedeemed":47},"events":[{"event":e,"applications":40+i,"tickets":20+i,"checkedIn":10+i,"admissionRevenueCents":70000+i*2500,"addonRevenueCents":18000+i*1000,"drinkPackages":12+i,"lateStayPasses":7+i} for i,e in enumerate(REALMS)],"generatedAt":"2026-09-17T22:00:00Z"}
PACKAGES={"event":REALMS[0],"summary":{"drinkPackages":21,"drinkCreditsPurchased":126,"drinkCreditsRedeemed":47,"drinkCreditsRemaining":79,"wristbandsActivated":18,"lateStayPasses":8,"addonRevenueCents":63800,"refundedOrDisputed":2},"entitlements":[{"ticketId":"WLD-AUR-001","addonType":"drink_package","status":"active","creditsPurchased":6,"creditsRedeemed":2,"creditsRemaining":4,"wristbandCode":"A042"},{"ticketId":"WLD-AUR-002","addonType":"late_stay","status":"active"}]}
OPS={"event":REALMS[0],"events":REALMS,"stats":{"applications":88,"ticketsActive":47,"checkedIn":31,"invitationsActive":9,"comps":3,"refunded":2,"admissionRevenueCents":164500,"addonRevenueCents":63800,"approved":62,"invitationsRedeemed":54,"invitationsFulfilled":47,"activeAddons":29,"checkins":31,"pending":14},"tickets":[{"ticketId":"WLD-AUR-001","guestName":"Rehearsal Guest","email":"qa@example.com","status":"paid","ticketSource":"stripe","amountTotal":3500,"issuedAt":"2026-09-17T12:00:00Z"},{"ticketId":"WLD-AUR-002","guestName":"Checked In Guest","email":"checked@example.com","status":"checked_in","ticketSource":"comp","amountTotal":0,"issuedAt":"2026-09-17T11:00:00Z","checkedInAt":"2026-09-17T19:00:00Z"}],"invitations":[{"invitationId":"qa-invite-1","guestName":"Invited Guest","email":"invite@example.com","status":"redeemed","createdAt":"2026-09-16T12:00:00Z","expiresAt":"2026-10-01T12:00:00Z","purchaseCount":0}],"entitlements":[{"entitlementId":"qa-ent-1","ticketId":"WLD-AUR-001","addonType":"drink_package","status":"active","priceCents":6000,"purchasedAt":"2026-09-17T12:30:00Z","creditsRedeemed":2,"creditsRemaining":4},{"entitlementId":"qa-ent-2","ticketId":"WLD-AUR-002","addonType":"late_stay","status":"active","priceCents":2000,"purchasedAt":"2026-09-17T12:40:00Z","departureTime":"10:00 AM"}]}
ADDONS={"event":REALMS[0],"ticketId":"WLD-AUR-QA","addons":[
 {"addonType":"drink_package","name":"Drink Package","priceCents":6000,"description":"Prepaid festival drink credits.","credits":6,"status":"available","purchased":True,"entitlement":{"status":"active","creditsRemaining":4}},
 {"addonType":"late_stay","name":"Late Checkout / Car Camping","priceCents":2000,"description":"Remain onsite after the festival.","departureTime":"10:00 AM","status":"available","purchased":False},
 {"addonType":"vip","name":"VIP Access","priceCents":9000,"description":"Priority entry and VIP areas.","status":"coming_soon","purchased":False},
 {"addonType":"parking","name":"Reserved Parking","priceCents":2500,"description":"Reserved event parking.","status":"sold_out","purchased":False}
]}
ACCESS={"event":REALMS[0],"eligible":True,"purchaseAvailable":True,"priceCents":3500,"currency":"usd","offer":{"phase":2,"name":"SECOND RELEASE","priceCents":3500},"invitation":{"invitationId":"qa-invite","status":"redeemed","maxTickets":1},"existingTicketId":None}
APP_CONFIG={"event":REALMS[2],"turnstileSiteKey":None,"applicationsReady":True}
IND_EVENT=[{"id":"gate","label":"Gate readiness","state":"green","detail":"Scanner ready"},{"id":"waivers","label":"Unsigned waivers","state":"yellow","detail":"4 pending"},{"id":"bar","label":"Bartender console","state":"green","detail":"Ready"},{"id":"wallet","label":"Apple Wallet","state":"yellow","detail":"Physical verification pending"}]
IND_LAUNCH=[{"id":"core","label":"Core platform","state":"green","detail":"Configured"},{"id":"stripe","label":"Stripe live mode","state":"red","detail":"TEST mode"},{"id":"wallet","label":"Apple Wallet","state":"red","detail":"Signing pending"},{"id":"rehearsal","label":"Full rehearsal","state":"yellow","detail":"6 passed · 4 pending"}]
READINESS={"event":REALMS[0],"events":REALMS,"config":{"database":True,"admin":True,"stripe":True,"stripeMode":"test","turnstile":True,"email":True,"ticketSigning":True,"gate":True,"bar":True,"passport":True,"venue":True,"wallet":False},"coreReady":True,"coreBlockers":[],"launchReady":False,"launchBlockers":["Stripe live mode","Apple Wallet signing"],"blockers":[],"decisions":{"eventDay":{"go":False,"label":"NO-GO","summary":"Action required."},"live":{"go":False,"label":"NO-GO","summary":"Action required."},"launch":{"go":False,"label":"NO-GO","summary":"Launch blocked."},"rehearsal":{"go":False,"label":"NO-GO","summary":"4 pending."}},"indicators":{"eventDay":IND_EVENT,"live":IND_EVENT,"launch":IND_LAUNCH,"rehearsal":IND_LAUNCH},"live":{"counts":{"applications":88,"approved":62,"invitations":54,"activeTickets":47,"checkedIn":31,"unsignedWaivers":4,"signedWaivers":43,"refundedTickets":2,"activeAddons":29,"activeDrinkPackages":21,"activeWristbands":18,"creditsRedeemed":47,"creditsRemaining":79,"checkinRecords":31},"revenue":{"admissionCents":164500,"addonCents":63800,"totalCents":228300},"recentCheckins":[{"guestName":"QA Guest","ticketId":"WLD-AUR-QA","checkedInAt":"2026-09-17T18:30:00-10:00"}],"recentWristbands":[{"ticketId":"WLD-AUR-QA","wristbandCode":"A042","creditsRedeemed":2,"creditsRemaining":4,"updatedAt":"2026-09-17T18:35:00-10:00"}]},"rehearsal":{"tester":"QA","passed":6,"failed":0,"pending":4,"percent":60,"ready":False,"items":[{"id":"wallet-install","label":"Apple Wallet","detail":"Physical test","status":"pending","note":""},{"id":"gate-scan","label":"Gate scan","detail":"Physical test","status":"pending","note":""},{"id":"bartender-redemption","label":"Bartender redemption","detail":"Physical test","status":"pending","note":""},{"id":"refund","label":"Refund","detail":"Physical test","status":"pending","note":""}]},"generatedAt":"2026-09-17T22:00:00Z"}

@dataclass(frozen=True)
class Case:
 name:str
 path:str
 state:str="plain"
 wait:str|None="h1"

SUITES={
 "public":[Case("home","/","home","main"),*[Case("event-"+r["slug"],"/events/"+r["slug"]) for r in REALMS],*[Case("apply-"+r["slug"],"/apply/"+r["slug"],"apply-"+r["slug"],"#gateNotice") for r in REALMS]],
 "transactional":[Case("passport-auth","/passport","passport","#account:not([hidden])"),Case("passport-login","/passport","passport-login","#login:not([hidden])"),Case("invite","/invite","plain","#inviteForm"),Case("ticket-access","/ticket-access?event=aureva","ticket-access","#buy:not([hidden])"),Case("public-tickets","/public-tickets/sunveil","public-tickets","#public-ticket-form"),Case("ticket-addons","/ticket/addons?token=qa-token","ticket-addons","#addons .card")],
 "admin":[Case("admin-applications","/admin","admin-apps","#adminPanel:not(.hidden)"),Case("admin-overview","/admin/overview","overview","#events .event"),Case("admin-packages","/admin/packages","packages","#report .metric"),Case("admin-operations","/admin/operations","operations","#opsPanel:not(.hidden)"),Case("admin-event-day","/admin/event-day","command","#indicatorGrid > *"),Case("admin-live","/admin/live","command","#indicatorGrid > *"),Case("admin-launch","/admin/launch","command","#indicatorGrid > *"),Case("admin-rehearsal","/admin/rehearsal","command","#indicatorGrid > *")],
 "staff":[Case("check-in","/check-in","check-in","#gate:not([hidden])"),Case("bar","/bar","bar","#bar:not([hidden])")]
}
VIEWPORTS={"chromium":[("phone-small",320,568,2),("phone",390,844,2),("landscape",844,390,1),("tablet",768,1024,2),("laptop",1024,768,1),("desktop",1440,1000,1),("wide",1920,1080,1)],"webkit":[("phone-small",320,568,2),("phone",390,844,2),("tablet",768,1024,2),("desktop",1440,1000,1)]}
SHOTS={"chromium":{"phone-small","phone","tablet","desktop","wide"},"webkit":{"phone","desktop"}}

def fulfill(route,payload,status=200):
 route.fulfill(status=status,content_type="application/json",body=json.dumps(payload))

def fixtures(page,state):
 page.add_init_script("window.turnstile={render:()=>1,getResponse:()=>'qa',reset:()=>{},remove:()=>{}}")
 page.route("https://challenges.cloudflare.com/**",lambda r:r.fulfill(status=200,content_type="application/javascript",body=""))
 if state.startswith("apply-"):
  slug=state.removeprefix("apply-")
  event=next((x for x in REALMS if x["slug"]==slug),REALMS[0])
  cfg={"event":dict(event,applicationOpen=(slug=="aureva"),routes":{"event":event["routes"]["event"],"apply":"/apply/"+slug}),"applicationsReady":True,"turnstileSiteKey":"qa"}
  page.route("**/api/app-config?*",lambda r:fulfill(r,cfg))
 elif state=="passport": page.route("**/api/passport",lambda r:fulfill(r,PASSPORT))
 elif state=="passport-login":
  page.route("**/api/passport",lambda r:fulfill(r,{"authenticated":False},401)); page.route("**/api/passport/config",lambda r:fulfill(r,{"turnstileSiteKey":"qa"}))
 elif state=="ticket-access": page.route("**/api/ticket/access?*",lambda r:fulfill(r,ACCESS))
 elif state=="public-tickets": page.route("**/api/app-config?*",lambda r:fulfill(r,APP_CONFIG))
 elif state=="ticket-addons": page.route("**/api/ticket/addons?*",lambda r:fulfill(r,ADDONS))
 elif state=="admin-apps":
  page.route("**/api/admin/auth",lambda r:fulfill(r,{"authenticated":True})); page.route("**/api/admin/applications*",lambda r:fulfill(r,ADMIN_APPS))
 elif state=="overview": page.route("**/api/admin/overview",lambda r:fulfill(r,OVERVIEW))
 elif state=="packages": page.route("**/api/admin/package-report?*",lambda r:fulfill(r,PACKAGES))
 elif state=="operations":
  page.route("**/api/admin/auth",lambda r:fulfill(r,{"authenticated":True})); page.route("**/api/admin/operations?*",lambda r:fulfill(r,OPS)); page.route("**/api/admin/applications*",lambda r:fulfill(r,ADMIN_APPS))
 elif state=="command":
  page.route("**/api/admin/readiness*",lambda r:fulfill(r,READINESS)); page.route("**/api/admin/auth",lambda r:fulfill(r,{"authenticated":True}))
 elif state=="check-in": page.route("**/api/check-in",lambda r:fulfill(r,{"event":REALMS[0]}))
 elif state=="bar": page.route("**/api/bar",lambda r:fulfill(r,{"event":REALMS[0]}))

def same_origin(url):
 return urlparse(url).netloc==urlparse(BASE).netloc

def dom(page):
 return page.evaluate("""() => {
 const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity!==0&&r.width>0&&r.height>0};
 const ids=[...document.querySelectorAll('[id]')].map(e=>e.id).filter(Boolean);
 const dups=[...new Set(ids.filter((x,i)=>ids.indexOf(x)!==i))];
 const unlabeled=[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(e=>vis(e)&&!(e.labels?.length||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||e.title)).map(e=>e.id||e.name||e.tagName);
 const unnamed=[...document.querySelectorAll('button,summary')].filter(e=>vis(e)&&!((e.innerText||'').trim()||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||e.title)).map(e=>e.id||e.className||e.tagName);
 const broken=[...document.images].filter(i=>vis(i)&&(!i.complete||i.naturalWidth===0)).map(i=>i.src);
 const missingAlt=[...document.images].filter(i=>vis(i)&&!i.hasAttribute('alt')).map(i=>i.src);
 const tiny=[...document.querySelectorAll('button,input:not([type=hidden]),select,textarea,summary,.button')].filter(e=>{if(!vis(e))return false;const r=e.getBoundingClientRect();return r.width<30||r.height<30}).slice(0,20).map(e=>({tag:e.tagName,w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height)}));
 const h1=[...document.querySelectorAll('h1')].find(vis);
 return {title:document.title,h1:h1?.textContent?.trim()||'',overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,dups,unlabeled,unnamed,broken,missingAlt,tiny,text:(document.querySelector('main')?.innerText||'').trim().length};
 }""")

def state_checks(page,case):
 f=[]
 if case.state=="home":
  for s in ("#aureva","#halora","#sunveil","#nocturne"):
   if page.locator(s).count()!=1:f.append("missing "+s)
 elif case.state.startswith("apply-"):
  slug=case.path.rsplit("/",1)[-1]
  form_visible=page.locator("#applyForm").is_visible()
  if slug=="aureva" and not form_visible:f.append("AUREVA application form should be open in QA fixture")
  if slug!="aureva" and form_visible:f.append(slug+" application form should remain gated in QA fixture")
 elif case.state=="passport":
  if page.locator("#realms .passport-card").count()!=5:f.append("Passport must render 4 realms + Master Cycle")
  if page.locator('[data-master-cycle="locked"]').count()!=1:f.append("Master Cycle credential missing")
  if page.locator("#cycleNodes .passport-cycle-node").count()!=4:f.append("cycle meter missing nodes")
  if page.locator(".passport-header .realm-gradient-title").count()!=1:f.append("premium title class missing")
  if page.locator(".passport-header .tx-subheadline").count()!=1:f.append("premium subheadline class missing")
 elif case.state=="ticket-access":
  if "$35" not in page.locator("#price").inner_text():f.append("ticket price did not render")
 elif case.state=="public-tickets":
  if "SUNVEIL" not in page.locator("[data-name]").inner_text():f.append("SUNVEIL branding missing")
 elif case.state=="ticket-addons":
  if page.locator("#addons .card").count()!=4:f.append("add-on state matrix incomplete")
  for x in ("active","available","sold-out","coming-soon"):
   if page.locator(".addon-status-badge--"+x).count()<1:f.append("missing add-on state "+x)
 elif case.state=="admin-apps" and page.locator("#applicationList [data-select-id]").count()<2:f.append("admin application rows missing")
 elif case.state=="overview" and page.locator("#events .event").count()!=4:f.append("dashboard realm summaries missing")
 elif case.state=="packages" and page.locator("#report .metric").count()<8:f.append("package metrics missing")
 elif case.state=="operations":
  if page.locator("#ticketRows .ops-row").count()<2:f.append("operations rows missing")
  for t in ("invites","comps","addons","reports","tickets"):
   page.locator('[data-tab="'+t+'"]').click(); page.wait_for_timeout(40)
   if not page.locator("#view"+t[0].upper()+t[1:]).is_visible():f.append("tab failed "+t)
 elif case.state=="command" and page.locator("#indicatorGrid > *").count()<3:f.append("command indicators missing")
 elif case.state=="check-in" and not page.locator("#gate").is_visible():f.append("gate console missing")
 elif case.state=="bar" and not page.locator("#bar").is_visible():f.append("bar console missing")
 return f

def mobile_menu(page,width):
 if width>850 or page.locator("details.mobile-menu summary").count()==0:return None
 s=page.locator("details.mobile-menu summary").first;s.click();page.wait_for_timeout(60)
 ok=page.locator("details.mobile-menu").first.get_attribute("open") is not None and page.locator("details.mobile-menu[open] nav a:visible").count()>0
 if ok:s.click()
 return ok

def browser_mode(suite,browser_name):
 from playwright.sync_api import sync_playwright
 root=OUT/(suite+"-"+browser_name);root.mkdir(parents=True,exist_ok=True);results=[]
 with sync_playwright() as p:
  browser=getattr(p,browser_name).launch()
  for vp,w,h,dpr in VIEWPORTS[browser_name]:
   ctx=browser.new_context(viewport={"width":w,"height":h},device_scale_factor=dpr,is_mobile=w<900,has_touch=w<900,color_scheme="dark")
   for case in SUITES[suite]:
    page=ctx.new_page();errors=[];console=[];reqfail=[];assetfail=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    page.on("console",lambda m:console.append(m.text) if m.type=="error" and "challenges.cloudflare.com" not in m.text and not (case.state=="passport-login" and "401 (Unauthorized)" in m.text) else None)
    page.on("requestfailed",lambda r:reqfail.append(r.url) if same_origin(r.url) and not (r.resource_type=="image" and "ERR_ABORTED" in str(r.failure).upper()) else None)
    page.on("response",lambda r:assetfail.append({"url":r.url,"status":r.status}) if same_origin(r.url) and r.status>=400 and r.request.resource_type in {"document","script","stylesheet","image","font"} else None)
    fixtures(page,case.state);rep={"suite":suite,"browser":browser_name,"viewport":vp,"width":w,"case":case.name,"path":case.path}
    try:
     resp=page.goto(BASE+case.path,wait_until="domcontentloaded",timeout=45000);rep["status"]=resp.status if resp else 0
     if case.wait:page.wait_for_selector(case.wait,state="visible",timeout=15000)
     page.wait_for_timeout(250)
     height=page.evaluate("document.documentElement.scrollHeight")
     for y in range(0,int(height),700):page.evaluate("y=>window.scrollTo(0,y)",y);page.wait_for_timeout(25)
     page.evaluate("window.scrollTo(0,0)");page.wait_for_timeout(100)
     checks=state_checks(page,case);audit=dom(page);menu=mobile_menu(page,w)
     rep.update(audit);rep.update({"pageErrors":errors,"consoleErrors":console,"requestFailures":reqfail,"assetFailures":assetfail,"stateFailures":checks,"mobileMenuOk":menu})
     rep["failed"]=any([rep["status"]>=400,errors,console,reqfail,assetfail,audit["overflow"],audit["dups"],audit["unlabeled"],audit["unnamed"],audit["broken"],audit["missingAlt"],not audit["title"],not audit["h1"],audit["text"]<20,checks,menu is False])
    except Exception as e:
     rep["exception"]=str(e);rep["failed"]=True
    if vp in SHOTS[browser_name] or rep["failed"]:
     try:page.screenshot(path=str(root/(vp+"-"+case.name+".png")),full_page=True,animations="disabled",caret="hide")
     except Exception as e:rep["screenshotError"]=str(e);rep["failed"]=True
    results.append(rep);page.close()
   ctx.close()
  browser.close()
 with sync_playwright() as p:
  b=getattr(p,browser_name).launch();c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,reduced_motion="reduce");page=c.new_page();case=SUITES[suite][0];fixtures(page,case.state)
  motion={"suite":suite,"browser":browser_name,"case":case.name,"reducedMotion":True}
  try:
   r=page.goto(BASE+case.path,wait_until="domcontentloaded",timeout=45000)
   if case.wait:page.wait_for_selector(case.wait,state="visible",timeout=15000)
   page.wait_for_timeout(300);motion_state=page.evaluate("""() => {
 const candidates=[...document.querySelectorAll('.orbit,.reveal,.wo-stars i,.hero-logo-wrap:after,.realm-logo-frame:after')];
 const bad=candidates.filter(e=>{const s=getComputedStyle(e);return s.animationName&&s.animationName!=='none'&&s.animationPlayState!=='paused'}).length;
 return {candidateCount:candidates.length,activeAnimatedCandidates:bad,media:matchMedia('(prefers-reduced-motion: reduce)').matches};
}""");motion.update(status=r.status if r else 0,**motion_state,failed=(not motion_state["media"] or motion_state["activeAnimatedCandidates"]>0))
  except Exception as e:motion.update(exception=str(e),failed=True)
  results.append(motion);page.close();c.close();b.close()
 (root/"report.json").write_text(json.dumps(results,indent=2),encoding="utf-8")
 failures=[r for r in results if r.get("failed")];print(json.dumps({"checks":len(results),"failures":len(failures),"tinyWarnings":sum(len(r.get("tiny",[])) for r in results)},indent=2))
 if failures:print(json.dumps(failures[:12],indent=2))
 return 1 if failures else 0

class Audit(HTMLParser):
 def __init__(self):super().__init__();self.ids=[];self.refs=[];self.viewport=False;self.title=False
 def handle_starttag(self,tag,attrs):
  d=dict(attrs)
  if d.get("id"):self.ids.append(d["id"])
  if tag=="meta" and d.get("name","").lower()=="viewport":self.viewport=True
  if tag=="title":self.title=True
  for k in ("src","href"):
   v=d.get(k)
   if v and v.startswith("/") and not v.startswith("//"):self.refs.append(v)

def source_mode():
 OUT.mkdir(parents=True,exist_ok=True);fail=[];warn=[]
 html=sorted(SITE.rglob("*.html"))
 for p in html:
  a=Audit();a.feed(p.read_text(encoding="utf-8"))
  if not a.viewport:fail.append(str(p)+": missing viewport")
  if not a.title:fail.append(str(p)+": missing title")
  dup=sorted({x for x in a.ids if a.ids.count(x)>1})
  if dup:fail.append(str(p)+": duplicate ids "+str(dup))
  for ref in a.refs:
   ref=ref.split("?",1)[0].split("#",1)[0]
   if ref.startswith("/assets/") or ref=="/favicon.svg":
    if not (SITE/ref.lstrip("/")).exists():fail.append(str(p)+": missing "+ref)
 for p in sorted((SITE/"assets/css").glob("*.css")):
  for raw in re.findall(r"url\(([^)]+)\)",p.read_text(encoding="utf-8")):
   raw=raw.strip().strip("'\"")
   if raw.startswith("/") and not (SITE/raw.lstrip("/")).exists():fail.append(str(p)+": missing css asset "+raw)
 required={"/","/events/aureva","/events/halora","/events/sunveil","/events/nocturne","/apply/aureva","/apply/halora","/apply/sunveil","/apply/nocturne","/passport","/invite","/ticket-access","/public-tickets/sunveil","/ticket/addons","/admin","/admin/overview","/admin/packages","/admin/operations","/admin/event-day","/admin/live","/admin/launch","/admin/rehearsal","/check-in","/bar"}
 matrix={c.path.split("?",1)[0] for cases in SUITES.values() for c in cases}
 if required-matrix:fail.append("browser matrix missing "+str(sorted(required-matrix)))
 passport=(SITE/"assets/js/passport.js").read_text(encoding="utf-8");ph=(SITE/"passport.html").read_text(encoding="utf-8");css=(SITE/"assets/css/transactional-hero.css").read_text(encoding="utf-8");tv=Path("netlify/functions/ticket-view.mjs").read_text(encoding="utf-8")
 for s in ("MASTER CYCLE","passport-master-card"):
  if s not in passport:fail.append("passport regression guard missing "+s)
 if "realm-gradient-title tx-display-title" not in ph:fail.append("premium Passport title markup missing")
 for s in (".tx-display-title",".tx-page-title",".tx-section-title",".tx-label",".tx-subheadline"):
  if s not in css:fail.append("shared typography missing "+s)
 if "ticket-entitlement-badge" not in tv:fail.append("ticket entitlement badge hook missing")
 report={"htmlFiles":len(html),"failures":fail,"warnings":warn};(OUT/"source-audit.json").write_text(json.dumps(report,indent=2),encoding="utf-8");print(json.dumps(report,indent=2));return 1 if fail else 0

def get(path,timeout=25):
 try:
  with urlopen(Request(BASE+path,headers={"User-Agent":"EnterWildOnes-Production-QA/2.0","Cache-Control":"no-cache"}),timeout=timeout) as r:return r.status,{k.lower():v for k,v in r.headers.items()},r.read()
 except HTTPError as e:return e.code,{k.lower():v for k,v in e.headers.items()},e.read()

def smoke_mode():
 OUT.mkdir(parents=True,exist_ok=True);checks=[];fail=[]
 routes=["/"]+[f"/events/{r['slug']}" for r in REALMS]+[f"/apply/{r['slug']}" for r in REALMS]+["/passport","/invite","/ticket-access","/public-tickets/sunveil","/ticket/addons","/admin","/admin/overview","/admin/packages","/admin/operations","/admin/event-day","/admin/live","/admin/launch","/admin/rehearsal","/check-in","/bar"]
 for path in routes:
  s,h,b=get(path);ok=s<400 and len(b)>100;checks.append({"path":path,"status":s,"bytes":len(b),"ok":ok})
  if not ok:fail.append(path+" unhealthy")
 for r in REALMS:
  path="/api/app-config?event="+r["slug"];s,h,b=get(path)
  try:ok=s==200 and json.loads(b.decode()).get("event",{}).get("name")==r["name"]
  except Exception:ok=False
  checks.append({"path":path,"status":s,"ok":ok})
  if not ok:fail.append(path+" event config failed")
 for path,expected in [("/api/admin/overview",{401,403}),("/api/admin/operations",{401,403}),("/api/ticket/addons?token=invalid",{400,401,403}),("/ticket?token=invalid",{400,401,403}),("/api/check-in",{401,403}),("/api/bar",{401,403})]:
  s,h,b=get(path);ok=s in expected;checks.append({"path":path,"status":s,"expected":sorted(expected),"ok":ok})
  if not ok:fail.append(path+" did not fail closed")
 for path,private in [("/",False),("/passport",True),("/admin",True),("/ticket-access",True),("/check-in",True)]:
  s,h,b=get(path);missing=[x for x in ("strict-transport-security","content-security-policy","x-content-type-options","x-frame-options","referrer-policy") if not h.get(x)]
  if private and "no-store" not in h.get("cache-control","").lower():missing.append("cache-control:no-store")
  if private and "noindex" not in h.get("x-robots-tag","").lower():missing.append("x-robots-tag:noindex")
  ok=s<400 and not missing;checks.append({"path":path,"status":s,"missingHeaders":missing,"ok":ok})
  if not ok:fail.append(path+" header audit failed "+str(missing))
 report={"base":BASE,"checks":checks,"failures":fail};(OUT/"production-smoke.json").write_text(json.dumps(report,indent=2),encoding="utf-8");print(json.dumps({"checks":len(checks),"failures":fail},indent=2));return 1 if fail else 0

def wait_mode(before):
 before=(before or "").strip();candidates=[]
 if re.fullmatch(r"[0-9a-fA-F]{40}",before) and before!="0"*40:
  try:
   for name in subprocess.check_output(["git","diff","--name-only",before,"HEAD","--","site"],text=True).splitlines():
    p=Path(name)
    if p.is_file() and p.stat().st_size<=5000000:candidates.append(p)
  except Exception:pass
 if candidates:
  p=candidates[0];remote="/"+str(p.relative_to(SITE)).replace(os.sep,"/");local=hashlib.sha256(p.read_bytes()).hexdigest();deadline=time.time()+600
  while time.time()<deadline:
   s,h,b=get(remote,20)
   if s==200 and hashlib.sha256(b).hexdigest()==local:print(json.dumps({"productionSynced":True,"path":remote},indent=2));return 0
   time.sleep(10)
  print(json.dumps({"productionSynced":False,"path":remote},indent=2));return 1
 if re.fullmatch(r"[0-9a-fA-F]{40}",before) and before!="0"*40:
  try:
   changed=subprocess.check_output(["git","diff","--name-only",before,"HEAD"],text=True).splitlines()
   if any(x.startswith("netlify/functions/") or x=="netlify.toml" for x in changed):time.sleep(45)
  except Exception:pass
 s,h,b=get("/");ok=s==200 and len(b)>100;print(json.dumps({"productionReachable":ok,"status":s},indent=2));return 0 if ok else 1

def main():
 p=argparse.ArgumentParser();p.add_argument("--mode",choices=("source","wait","smoke","browser"),required=True);p.add_argument("--suite",choices=tuple(SUITES),default="public");p.add_argument("--browser",choices=tuple(VIEWPORTS),default="chromium");p.add_argument("--before",default=os.environ.get("BEFORE_SHA",""));a=p.parse_args()
 if a.mode=="source":return source_mode()
 if a.mode=="wait":return wait_mode(a.before)
 if a.mode=="smoke":return smoke_mode()
 return browser_mode(a.suite,a.browser)

if __name__=="__main__":sys.exit(main())
