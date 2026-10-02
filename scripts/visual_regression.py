#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, sys, threading, shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from PIL import Image, ImageChops, ImageFilter, ImageStat
from playwright.sync_api import sync_playwright
import production_visual_qa as qa

ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/"site"
OUT=ROOT/"visual-regression-results"

# One stable screenshot for every major guest, ticketing, admin and event-day state.
CASES=[
 {"name":"home-desktop","path":"/","state":"home","viewport":(1440,1000),"dpr":1,"wait":"main"},
 {"name":"home-passport-close-desktop","path":"/","state":"home","viewport":(1440,1000),"dpr":1,"wait":".v2-passport","action":"scroll-passport","full_page":False},
 {"name":"home-footer-desktop","path":"/","state":"home","viewport":(1440,1000),"dpr":1,"wait":".site-footer","action":"scroll-footer","full_page":False},
 {"name":"home-footer-phone","path":"/","state":"home","viewport":(390,844),"dpr":2,"wait":".site-footer","action":"scroll-footer","full_page":False},
 {"name":"home-footer-wide","path":"/","state":"home","viewport":(1920,1080),"dpr":1,"wait":".site-footer","action":"scroll-footer","full_page":False},
 {"name":"masthead-home-320","path":"/","state":"home","viewport":(320,568),"dpr":2,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-home-phone","path":"/","state":"home","viewport":(390,844),"dpr":2,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-home-430","path":"/","state":"home","viewport":(430,932),"dpr":3,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-home-768","path":"/","state":"home","viewport":(768,1024),"dpr":2,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-home-1024","path":"/","state":"home","viewport":(1024,768),"dpr":1,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-home-1366","path":"/","state":"home","viewport":(1366,768),"dpr":1,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-home-1440","path":"/","state":"home","viewport":(1440,1000),"dpr":1,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-home-1920","path":"/","state":"home","viewport":(1920,1080),"dpr":1,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-event-phone","path":"/events/aureva","state":"plain","viewport":(390,844),"dpr":2,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-quiz-phone","path":"/find-your-realm","state":"plain","viewport":(390,844),"dpr":2,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-passport-phone","path":"/passport","state":"passport-login","viewport":(390,844),"dpr":2,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-invite-phone","path":"/invite","state":"plain","viewport":(390,844),"dpr":2,"wait":".topbar .brand-label","full_page":False},
 {"name":"masthead-apply-phone","path":"/apply/aureva","state":"apply-aureva","viewport":(390,844),"dpr":2,"wait":".topbar .brand-label","full_page":False},
 {"name":"realm-quiz-intro-desktop","path":"/find-your-realm","state":"plain","viewport":(1440,1000),"dpr":1,"wait":"#quizIntro:not([hidden])"},
 {"name":"realm-quiz-result-desktop","path":"/find-your-realm?realm=nocturne","state":"plain","viewport":(1440,1000),"dpr":1,"wait":"#quizResult:not([hidden])"},
 {"name":"realm-quiz-intro-1366","path":"/find-your-realm","state":"plain","viewport":(1366,768),"dpr":1,"wait":"#quizIntro:not([hidden])","full_page":False},
 {"name":"realm-quiz-question-1366","path":"/find-your-realm","state":"plain","viewport":(1366,768),"dpr":1,"wait":"#quizStage:not([hidden])","action":"start-quiz","full_page":False},
 {"name":"realm-quiz-aureva-result-1366","path":"/find-your-realm?realm=aureva","state":"plain","viewport":(1366,768),"dpr":1,"wait":"#quizResult:not([hidden])","full_page":False},
 {"name":"realm-quiz-halora-result-1366","path":"/find-your-realm?realm=halora","state":"plain","viewport":(1366,768),"dpr":1,"wait":"#quizResult:not([hidden])","full_page":False},
 {"name":"realm-quiz-sunveil-result-1366","path":"/find-your-realm?realm=sunveil","state":"plain","viewport":(1366,768),"dpr":1,"wait":"#quizResult:not([hidden])","full_page":False},
 {"name":"realm-quiz-nocturne-result-1366","path":"/find-your-realm?realm=nocturne","state":"plain","viewport":(1366,768),"dpr":1,"wait":"#quizResult:not([hidden])","full_page":False},
 {"name":"application-open-desktop","path":"/apply/aureva","state":"apply-aureva","viewport":(1440,1000),"dpr":1,"wait":"#applyForm"},
 {"name":"application-gated-desktop","path":"/apply/nocturne","state":"apply-nocturne","viewport":(1440,1000),"dpr":1,"wait":"#gateNotice"},

 {"name":"passport-auth-desktop","path":"/passport","state":"passport","viewport":(1440,1000),"dpr":1,"wait":"#account:not([hidden])"},
 {"name":"passport-login-phone","path":"/passport","state":"passport-login","viewport":(390,844),"dpr":2,"wait":"#login:not([hidden])"},
 {"name":"invite-desktop","path":"/invite","state":"plain","viewport":(1440,1000),"dpr":1,"wait":"#inviteForm"},
 {"name":"ticket-access-desktop","path":"/ticket-access?event=aureva","state":"ticket-access","viewport":(1440,1000),"dpr":1,"wait":"#buy:not([hidden])"},
 {"name":"public-ticket-desktop","path":"/public-tickets/sunveil","state":"public-tickets","viewport":(1440,1000),"dpr":1,"wait":"#public-ticket-form"},
 {"name":"ticket-addons-desktop","path":"/ticket/addons?token=qa-token","state":"ticket-addons","viewport":(1440,1000),"dpr":1,"wait":"#addons .card"},

 {"name":"admin-applications-desktop","path":"/admin","state":"admin-apps","viewport":(1440,1000),"dpr":1,"wait":"#adminPanel:not(.hidden)"},
 {"name":"admin-overview-desktop","path":"/admin/overview","state":"overview","viewport":(1440,1000),"dpr":1,"wait":"#events .event"},
 {"name":"admin-packages-desktop","path":"/admin/packages","state":"packages","viewport":(1440,1000),"dpr":1,"wait":"#report .metric"},
 {"name":"admin-operations-desktop","path":"/admin/operations","state":"operations","viewport":(1440,1000),"dpr":1,"wait":"#opsPanel:not(.hidden)"},
 {"name":"admin-event-day-desktop","path":"/admin/event-day","state":"command","viewport":(1440,1000),"dpr":1,"wait":"#indicatorGrid > *"},
 {"name":"admin-live-desktop","path":"/admin/live","state":"command","viewport":(1440,1000),"dpr":1,"wait":"#indicatorGrid > *"},
 {"name":"admin-launch-desktop","path":"/admin/launch","state":"command","viewport":(1440,1000),"dpr":1,"wait":"#indicatorGrid > *"},
 {"name":"admin-rehearsal-desktop","path":"/admin/rehearsal","state":"command","viewport":(1440,1000),"dpr":1,"wait":"#indicatorGrid > *"},

 {"name":"check-in-phone","path":"/check-in","state":"check-in","viewport":(390,844),"dpr":2,"wait":"#gate:not([hidden])"},
 {"name":"bar-phone","path":"/bar","state":"bar","viewport":(390,844),"dpr":2,"wait":"#bar:not([hidden])"},
]

MASTHEAD_VIEWPORTS=[
 ("320",320,568,2),("390",390,844,2),("430",430,932,3),("768",768,1024,2),
 ("1024",1024,768,1),("1366",1366,768,1),("1440",1440,1000,1),("1920",1920,1080,1),
]
MASTHEAD_ROUTES=[
 ("home","/","home"),
 ("realm-aureva","/events/aureva","plain"),
 ("realm-halora","/events/halora","plain"),
 ("realm-sunveil","/events/sunveil","plain"),
 ("realm-nocturne","/events/nocturne","plain"),
 ("quiz","/find-your-realm","plain"),
 ("passport","/passport","passport-login"),
 ("invite","/invite","plain"),
 ("apply","/apply/aureva","apply-aureva"),
]

ROUTES={
 "/":"index.html",
 "/find-your-realm":"find-your-realm.html",
 "/events/aureva":"events/aureva.html",
 "/events/halora":"events/halora.html",
 "/events/sunveil":"events/sunveil.html",
 "/events/nocturne":"events/nocturne.html",
 "/apply/aureva":"apply.html",
 "/apply/nocturne":"apply.html",
 "/passport":"passport.html",
 "/invite":"invite.html",
 "/ticket-access":"ticket-access.html",
 "/public-tickets/sunveil":"public-tickets.html",
 "/ticket/addons":"ticket-addons.html",
 "/admin":"admin.html",
 "/admin/overview":"admin-overview.html",
 "/admin/packages":"admin-packages.html",
 "/admin/operations":"admin-operations.html",
 "/admin/event-day":"admin-event-day.html",
 "/admin/live":"admin-live.html",
 "/admin/launch":"admin-launch.html",
 "/admin/rehearsal":"admin-rehearsal.html",
 "/check-in":"check-in.html",
 "/bar":"bar.html",
}

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
    def translate_path(self,path):
        clean=urlparse(path).path
        if clean in ROUTES:return str(SITE/ROUTES[clean])
        target=(SITE/clean.lstrip("/")).resolve()
        if SITE.resolve() not in target.parents and target!=SITE.resolve():return str(SITE/"index.html")
        return str(target)

def verify_mastheads(base_url:str,browser_name:str="chromium"):
    OUT.mkdir(exist_ok=True)
    rows=[];failures=[]
    viewport_reference={}

    def px(value):
      try:return float(str(value).replace("px",""))
      except Exception:return 0.0

    def center_delta(a,b):
      return abs((a["y"]+a["h"]/2)-(b["y"]+b["h"]/2))

    def minimums(width,compact=False):
      if width>=1024:
        return {"icon":96 if compact else 118,"label":10.8 if compact else 12.5,"sub":6.3 if compact else 7.2}
      if width>=700:
        return {"icon":72 if compact else 84,"label":8.4 if compact else 9.2,"sub":5.6 if compact else 6.0}
      if width>350:
        return {"icon":66 if compact else 76,"label":7.7 if compact else 8.4,"sub":5.2 if compact else 5.6}
      return {"icon":58 if compact else 64,"label":7.2 if compact else 7.7,"sub":4.9 if compact else 5.2}

    capture_js="""() => {
 const r=e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:b.x,y:b.y,w:b.width,h:b.height,font:s.fontSize,tracking:s.letterSpacing,fontFamily:s.fontFamily,fontWeight:s.fontWeight,display:s.display,visibility:s.visibility,opacity:+s.opacity}};
 const header=document.querySelector('.topbar'),brand=header?.querySelector('.brand'),icon=header?.querySelector('.brand-icon'),img=icon?.querySelector('img'),label=header?.querySelector('.brand-label'),sub=label?.querySelector('span');
 const hs=header?getComputedStyle(header):null,ims=img?getComputedStyle(img):null;
 return {
   header:r(header),brand:r(brand),icon:r(icon),image:r(img),label:r(label),sub:r(sub),
   labelText:(label?.childNodes?.[0]?.textContent||'').trim(),subText:(sub?.textContent||'').trim(),
   imageSrc:img?.getAttribute('src')||'',naturalW:img?.naturalWidth||0,naturalH:img?.naturalHeight||0,
   objectFit:ims?.objectFit||'',blur:hs?.backdropFilter||hs?.webkitBackdropFilter||'',shadow:hs?.boxShadow||''
 };
}"""

    def signature(metrics):
      return {
        "headerH":round(metrics["header"]["h"],2),
        "brandH":round(metrics["brand"]["h"],2),
        "iconW":round(metrics["icon"]["w"],2),
        "iconH":round(metrics["icon"]["h"],2),
        "labelW":round(metrics["label"]["w"],2),
        "labelH":round(metrics["label"]["h"],2),
        "labelFont":metrics["label"]["font"],
        "labelTracking":metrics["label"]["tracking"],
        "subW":round(metrics["sub"]["w"],2),
        "subH":round(metrics["sub"]["h"],2),
        "subFont":metrics["sub"]["font"],
        "subTracking":metrics["sub"]["tracking"],
      }

    def validate(metrics,width,compact,row):
      phase="compact" if compact else "expanded"
      mins=minimums(width,compact)
      header,brand,icon,image,label,sub=[metrics[k] for k in ("header","brand","icon","image","label","sub")]
      if metrics["labelText"]!="ENTER WILD ONES":row["failures"].append(f"ENTER WILD ONES wordmark missing in {phase} header")
      if metrics["subText"]!="THE FOUR REALMS":row["failures"].append(f"THE FOUR REALMS wordmark missing in {phase} header")
      if metrics["imageSrc"]!="/assets/images/realms/enter-wild-ones-emblem.svg":row["failures"].append(f"wrong masthead emblem asset in {phase} header")
      if metrics["objectFit"]!="contain":row["failures"].append(f"masthead emblem must use object-fit contain in {phase} header")
      if metrics["naturalW"]<900 or metrics["naturalH"]<700:row["failures"].append(f"masthead emblem source is undersized in {phase} header")
      if icon["h"]<=0 or abs((icon["w"]/icon["h"])-(960/735))>.015:row["failures"].append(f"masthead emblem aspect ratio distorted in {phase} header")
      if abs(image["w"]-icon["w"])>1 or abs(image["h"]-icon["h"])>1:row["failures"].append(f"masthead image does not fill ratio-safe icon box in {phase} header")
      if icon["y"]<header["y"]-1.5 or icon["y"]+icon["h"]>header["y"]+header["h"]+1.5:row["failures"].append(f"emblem clipped in {phase} header")
      if brand["y"]<header["y"]-1.5 or brand["y"]+brand["h"]>header["y"]+header["h"]+1.5:row["failures"].append(f"brand lockup clipped in {phase} header")
      if min(icon["y"]-header["y"],header["y"]+header["h"]-(icon["y"]+icon["h"]))<4:row["failures"].append(f"emblem lacks vertical breathing room in {phase} header")
      if center_delta(icon,label)>6:row["failures"].append(f"emblem and wordmark are vertically misaligned in {phase} header")
      if center_delta(brand,header)>2:row["failures"].append(f"brand lockup is not vertically centered in {phase} header")
      if icon["w"]<mins["icon"]:row["failures"].append(f"emblem undersized in {phase} header: {icon['w']:.1f}px")
      if px(label["font"])<mins["label"]:row["failures"].append(f"ENTER WILD ONES undersized in {phase} header: {label['font']}")
      if px(sub["font"])<mins["sub"]:row["failures"].append(f"THE FOUR REALMS undersized in {phase} header: {sub['font']}")
      if label["w"]<=0 or sub["w"]<=0:row["failures"].append(f"wordmark not visible in {phase} header")

    with sync_playwright() as p:
      browser=getattr(p,browser_name).launch()
      for vp,w,h,dpr in MASTHEAD_VIEWPORTS:
        for name,path,state in MASTHEAD_ROUTES:
          context=browser.new_context(viewport={"width":w,"height":h},device_scale_factor=dpr,is_mobile=w<900,has_touch=w<900,color_scheme="dark",reduced_motion="reduce")
          page=context.new_page();qa.fixtures(page,state)
          row={"viewport":vp,"width":w,"route":name,"path":path,"failures":[]}
          try:
            page.goto(base_url+path,wait_until="domcontentloaded",timeout=30000)
            page.wait_for_selector(".topbar .brand-label",state="visible",timeout=15000)
            page.wait_for_function("document.body.classList.contains('wo-guest-masthead')",timeout=10000)
            page.wait_for_timeout(260)
            initial=page.evaluate(capture_js)
            validate(initial,w,False,row)
            initial_signature=signature(initial)
            ref=viewport_reference.get((vp,"expanded"))
            if ref is None:viewport_reference[(vp,"expanded")]=initial_signature
            elif initial_signature!=ref:row["failures"].append("expanded masthead physical dimensions differ across routes: "+str(ref)+" got "+str(initial_signature))

            page.evaluate("document.body.classList.add('masthead-scrolled')")
            page.wait_for_timeout(430)
            compact=page.evaluate(capture_js)
            validate(compact,w,True,row)
            if compact["header"]["h"]>=initial["header"]["h"]-1:row["failures"].append("masthead did not compact")
            if compact["blur"]==initial["blur"]:row["failures"].append("premium blur does not change on compact header")
            if compact["shadow"]==initial["shadow"]:row["failures"].append("premium shadow does not change on compact header")
            compact_signature=signature(compact)
            ref=viewport_reference.get((vp,"compact"))
            if ref is None:viewport_reference[(vp,"compact")]=compact_signature
            elif compact_signature!=ref:row["failures"].append("compact masthead physical dimensions differ across routes: "+str(ref)+" got "+str(compact_signature))

            row["expanded"]=initial;row["compact"]=compact
          except Exception as e:
            row["failures"].append(str(e))
          if row["failures"]:failures.append({"viewport":vp,"route":name,"issues":row["failures"]})
          rows.append(row);page.close();context.close()
      browser.close()
    serialized_reference={f"{vp}-{phase}":sig for (vp,phase),sig in viewport_reference.items()}
    report={"browser":browser_name,"viewports":[x[0] for x in MASTHEAD_VIEWPORTS],"routes":[x[0] for x in MASTHEAD_ROUTES],"routeDimensionReference":serialized_reference,"failures":failures,"checks":len(rows)}
    (OUT/f"masthead-geometry-{browser_name}.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    return report

def verify_home_chrome(base_url:str):
    failures=[];rows=[]
    viewports=[("320",320,568,2),("390",390,844,2),("430",430,932,3),("768",768,1024,2),("1024",1024,768,1),("1366",1366,768,1),("1440",1440,1000,1),("1920",1920,1080,1)]
    with sync_playwright() as p:
      browser=p.chromium.launch()
      for label,w,h,dpr in viewports:
        context=browser.new_context(viewport={"width":w,"height":h},device_scale_factor=dpr,is_mobile=w<900,has_touch=w<900,color_scheme="dark",reduced_motion="reduce")
        page=context.new_page();qa.fixtures(page,"home")
        row={"viewport":label,"issues":[]}
        try:
          page.goto(base_url+"/",wait_until="domcontentloaded",timeout=30000)
          page.wait_for_selector(".topbar .brand-label",state="visible",timeout=15000)
          page.wait_for_selector(".site-footer",state="attached",timeout=15000)
          page.wait_for_timeout(350)
          metrics=page.evaluate("""() => {
 const box=s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return r?{w:r.width,h:r.height,x:r.x,y:r.y}:null};
 const style=s=>{const x=getComputedStyle(document.querySelector(s));return {bg:x.backgroundImage,fill:x.webkitTextFillColor,color:x.color}};
 return {
  header:box('.topbar'), icon:box('.topbar .brand-icon'), label:box('.topbar .brand-label'),
  footer:box('.site-footer'), footerLogo:box('.site-footer .footer-brand'),
  footerNav:box('.site-footer nav'),
  kicker:style('.v2-passport .v2-kicker'), title:style('.v2-passport h2'),
  copy:style('.v2-passport .v2-passport-copy'), feature:style('.v2-passport .v2-passport-features span'),
  note:style('.v2-passport .v2-passport-note')
 };
}""")
          hb,ib,fb,fl=metrics["header"],metrics["icon"],metrics["footer"],metrics["footerLogo"]
          if w>=1024:
            if not hb or hb["h"]<110:row["issues"].append("header below canonical desktop minimum")
            if not ib or ib["w"]<118 or ib["h"]<90:row["issues"].append("emblem below canonical desktop minimum")
            if not fb or fb["h"]>82:row["issues"].append("footer above 82px")
            if not fl or fl["w"]>52 or fl["h"]>52:row["issues"].append("footer logo above 52px")
          elif w>=700:
            if not hb or hb["h"]<94:row["issues"].append("tablet header below canonical minimum")
            if not ib or ib["w"]<84:row["issues"].append("tablet emblem below canonical minimum")
            if not fb or fb["h"]>104:row["issues"].append("tablet footer above 104px")
          else:
            min_header=86 if w<=350 else 90
            min_icon=66 if w<=350 else 76
            if not hb or hb["h"]<min_header:row["issues"].append("mobile header below canonical minimum")
            if not ib or ib["w"]<min_icon:row["issues"].append("mobile emblem below canonical minimum")
            if not fb or fb["h"]>112:row["issues"].append("mobile footer above 112px")
            if not fl or fl["w"]>48 or fl["h"]>48:row["issues"].append("mobile footer logo above 48px")
          for key in ("kicker","title","copy","feature","note"):
            st=metrics[key]
            if "gradient" not in st["bg"]:row["issues"].append(key+" missing gradient")
            if st["fill"] not in ("transparent","rgba(0, 0, 0, 0)"):row["issues"].append(key+" gradient fill not transparent")
          row["metrics"]=metrics
        except Exception as e:
          row["issues"].append(str(e))
        if row["issues"]:failures.append({"viewport":label,"issues":row["issues"]})
        rows.append(row);page.close();context.close()
      browser.close()
    report={"failures":failures,"rows":rows}
    (OUT/"home-chrome-geometry.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    return report


def verify_ticket_credential_geometry(base_url:str):
    OUT.mkdir(exist_ok=True)
    viewports=[
      ("320",320,568,2),
      ("390",390,844,2),
      ("430",430,932,3),
      ("iphone-pro-max",440,956,3),
    ]
    rows=[];failures=[]
    css=[
      "/assets/css/branding.css",
      "/assets/css/retina-lockups.css",
      "/assets/css/realm-luxury-polish.css",
      "/assets/css/transactional-hero.css",
      "/assets/css/guest-transaction-detail.css",
      "/assets/css/transactional-premium.css",
    ]
    links="".join(f'<link rel="stylesheet" href="{base_url}{href}">' for href in css)
    html=f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">{links}</head>
<body class="ticket-page tx-page" data-realm="light" style="--a:#e6c879;--b:#030407;--f:#f7f0e5">
<main class="ticket-shell">
<header class="ticket-brand-header"><a href="#">ENTER WILD ONES</a><a href="#">MY PASSPORT</a></header>
<section class="ticket-intro"><p class="eyebrow tx-label">ENTER WILD ONES · DIGITAL CREDENTIAL</p><h1 class="tx-page-title">Your digital credential.</h1><p class="tx-subheadline">Present this credential for entry. Your waiver, QR access, event details, and add-ons remain attached to this ticket.</p></section>
<article class="ticket-credential" data-brand-realm="light" data-ticket-status="paid">
<div class="ticket-credential-topline"><span class="ticket-roman">I</span><span class="ticket-credential-label tx-meta-label">DIGITAL EVENT CREDENTIAL</span><span class="realm-chip realm-light tx-meta-label">REALM I · LIGHT</span></div>
<div class="ticket-logo-wrap"><div style="width:180px;aspect-ratio:1;border-radius:50%;border:1px solid color-mix(in srgb,var(--a) 34%,transparent);display:grid;place-items:center;color:var(--a);font:42px Georgia,serif">I</div></div>
<p class="eyebrow tx-label">ADMISSION CREDENTIAL</p><h2 class="ticket-event-name realm-key realm-light tx-card-title">AUREVA</h2><p class="ticket-tagline tx-body">Where the cycle begins in light.</p>
<div class="ticket-status-row"><span class="tx-meta-label">STATUS</span><strong>READY FOR ENTRY</strong></div>
<div class="ticket-meta-grid"><div><span class="tx-meta-label">GUEST</span><strong>Christopher</strong></div><div><span class="tx-meta-label">TICKET ID</span><strong>WLD-AUR-QA-1</strong></div><div><span class="tx-meta-label">DATE</span><strong>Sep 6, 2027</strong></div><div><span class="tx-meta-label">WAIVER</span><strong>RECORDED</strong></div></div>
<div class="ticket-qr-panel"><div class="ticket-qr-shell" style="aspect-ratio:1"><div style="width:100%;height:100%;background:repeating-linear-gradient(45deg,#000 0 6px,#fff 6px 12px)"></div></div><p class="ticket-qr-title tx-meta-label">SCAN AT ENTRY</p><p class="muted tx-body">Present this credential with matching photo ID.</p></div>
</article>
<div class="ticket-support-grid">
<section class="ticket-support-card"><p class="eyebrow tx-label">YOUR EXTRAS</p><h2 class="tx-card-title">Packages &amp; Add-Ons</h2><p class="tx-body">View drink packages, late checkout / car camping, and event-specific upgrades tied to this credential.</p><a class="button" href="#">Manage Add-Ons</a></section>
<section class="ticket-support-card"><p class="eyebrow tx-label">APPLE WALLET</p><h2 class="tx-card-title">Carry your credential.</h2><p class="tx-body">Add this event-bound ticket to Apple Wallet for fast access on event day.</p><a class="button" href="#">Add to Apple Wallet</a></section>
</div></main>
<footer class="site-footer"><nav><a href="#">THE REALMS</a><a href="#">PASSPORT</a><a href="#">CONTACT</a></nav><span>WILD ONES LLC / HAWAI'I / ENTERWILDONES.COM</span></footer>
</body></html>"""
    with sync_playwright() as p:
      browser=p.chromium.launch()
      for label,w,h,dpr in viewports:
        context=browser.new_context(viewport={"width":w,"height":h},device_scale_factor=dpr,is_mobile=True,has_touch=True,color_scheme="dark",reduced_motion="reduce")
        page=context.new_page();row={"viewport":label,"width":w,"height":h,"issues":[]}
        try:
          page.set_content(html,wait_until="networkidle",timeout=30000)
          page.wait_for_selector(".ticket-support-card .button",state="visible",timeout=10000)
          page.wait_for_timeout(200)
          metrics=page.evaluate("""() => {
 const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
 const shell=box(document.querySelector('.ticket-shell')),credential=box(document.querySelector('.ticket-credential')),grid=box(document.querySelector('.ticket-support-grid'));
 const cards=[...document.querySelectorAll('.ticket-support-card')].map(card=>{
   const button=card.querySelector('.button'),p=card.querySelector(':scope > p:not(.eyebrow)'),h2=card.querySelector('h2');
   const range=document.createRange();range.selectNodeContents(button);const tr=range.getBoundingClientRect(),br=button.getBoundingClientRect(),cr=card.getBoundingClientRect(),pr=p.getBoundingClientRect(),hr=h2.getBoundingClientRect();
   return {card:box(card),button:box(button),paragraph:box(p),heading:box(h2),buttonText:{x:tr.x,y:tr.y,w:tr.width,h:tr.height},centerDx:Math.abs((tr.x+tr.width/2)-(br.x+br.width/2)),centerDy:Math.abs((tr.y+tr.height/2)-(br.y+br.height/2)),bottomPad:cr.bottom-br.bottom};
 });
 const footer=box(document.querySelector('.site-footer'));
 const typeProps=e=>{const s=getComputedStyle(e);return {family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,line:s.lineHeight,tracking:s.letterSpacing,transform:s.textTransform}};
 const roles=['tx-display-title','tx-page-title','tx-section-title','tx-card-title','tx-subheadline','tx-body','tx-label','tx-meta-label'];
 const host=document.createElement('div');host.style.cssText='position:fixed;left:-200vw;top:0;visibility:hidden;pointer-events:none';
 for(const role of roles){const e=document.createElement('div');e.className=role;e.textContent='Typography contract';host.appendChild(e)}
 document.body.appendChild(host);
 const sample=Object.fromEntries(roles.map(role=>[role,typeProps(host.querySelector('.'+role))]));host.remove();
 const actual={
   'tx-page-title':typeProps(document.querySelector('.ticket-intro .tx-page-title')),
   'tx-card-title':typeProps(document.querySelector('.ticket-support-card .tx-card-title')),
   'tx-subheadline':typeProps(document.querySelector('.ticket-intro .tx-subheadline')),
   'tx-body':typeProps(document.querySelector('.ticket-support-card .tx-body')),
   'tx-label':typeProps(document.querySelector('.ticket-intro .tx-label')),
   'tx-meta-label':typeProps(document.querySelector('.ticket-status-row .tx-meta-label'))
 };
 return {scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,shell,credential,grid,cards,footer,typography:{sample,actual}};
}""")
          if metrics["scrollWidth"]>metrics["clientWidth"]+2:row["issues"].append("horizontal overflow")
          sample=metrics["typography"]["sample"];actual=metrics["typography"]["actual"]
          def type_px(value):
            try:return float(str(value).replace("px",""))
            except Exception:return 0.0
          sizes={k:type_px(v["size"]) for k,v in sample.items()}
          if not (sizes["tx-display-title"]>sizes["tx-page-title"]>sizes["tx-section-title"]>sizes["tx-card-title"]>sizes["tx-subheadline"]>=sizes["tx-body"]>sizes["tx-label"]):
            row["issues"].append("digital credential typography hierarchy is out of order")
          if len({sample[x]["family"] for x in ("tx-display-title","tx-page-title","tx-section-title","tx-card-title")})!=1:
            row["issues"].append("digital credential display roles do not share one font family")
          if len({sample[x]["family"] for x in ("tx-subheadline","tx-body","tx-label","tx-meta-label")})!=1:
            row["issues"].append("digital credential UI roles do not share one font family")
          for prop in ("family","size","weight","line","tracking","transform"):
            if sample["tx-label"][prop]!=sample["tx-meta-label"][prop]:row["issues"].append("digital credential label roles diverged on "+prop)
          for role,style in actual.items():
            for prop in ("family","size","weight","line","tracking","transform"):
              if style[prop]!=sample[role][prop]:row["issues"].append("digital credential "+role+" overrides shared "+prop)
          for name in ("shell","credential","grid"):
            b=metrics[name]
            if b["x"]<-1 or b["right"]>w+1:row["issues"].append(name+" escapes viewport")
          if abs(metrics["shell"]["x"]-(w-metrics["shell"]["right"]))>2.5:row["issues"].append("ticket shell is not horizontally centered")
          cards=metrics["cards"]
          if len(cards)!=2:row["issues"].append("support cards missing")
          else:
            gap=cards[1]["card"]["y"]-cards[0]["card"]["bottom"]
            if gap<10 or gap>24:row["issues"].append(f"support card gap {gap:.1f}px outside compact range")
            for i,card in enumerate(cards,1):
              cb,bb=card["card"],card["button"]
              if cb["h"]>315:row["issues"].append(f"support card {i} too tall at {cb['h']:.1f}px")
              if bb["x"]<cb["x"]-1 or bb["right"]>cb["right"]+1:row["issues"].append(f"support CTA {i} escapes card")
              if bb["w"]<cb["w"]*.78:row["issues"].append(f"support CTA {i} is not full-width enough on mobile")
              if bb["h"]<48:row["issues"].append(f"support CTA {i} below 48px tap target")
              if card["centerDx"]>3 or card["centerDy"]>4:row["issues"].append(f"support CTA {i} text is not centered")
              if card["bottomPad"]<18 or card["bottomPad"]>28:row["issues"].append(f"support card {i} bottom padding is uneven")
          row["metrics"]=metrics
          shot=OUT/f"ticket-credential-{label}.png"
          page.screenshot(path=str(shot),full_page=True,animations="disabled",caret="hide")
          row["screenshot"]=str(shot)
        except Exception as e:
          row["issues"].append(str(e))
        if row["issues"]:failures.append({"viewport":label,"issues":row["issues"]})
        rows.append(row);page.close();context.close()
      browser.close()
    report={"viewports":[x[0] for x in viewports],"rows":rows,"failures":failures}
    (OUT/"ticket-credential-geometry.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    return report


def normalize(src:Path,width=360):
    im=Image.open(src).convert("RGB")
    if im.width!=width:
        h=max(1,round(im.height*width/im.width))
        im=im.resize((width,h),Image.Resampling.LANCZOS)
    return im

def capture(base_url:str,dest:Path):
    dest.mkdir(parents=True,exist_ok=True)
    results=[]
    with sync_playwright() as p:
      browser=p.chromium.launch()
      for case in CASES:
        w,h=case["viewport"]
        context=browser.new_context(viewport={"width":w,"height":h},device_scale_factor=case["dpr"],is_mobile=w<900,has_touch=w<900,color_scheme="dark",reduced_motion="reduce")
        page=context.new_page()
        qa.fixtures(page,case["state"])
        page.goto(base_url+case["path"],wait_until="domcontentloaded",timeout=30000)
        if case.get("action")=="start-quiz":
          page.wait_for_selector("#quizIntro:not([hidden])",state="visible",timeout=15000)
          page.locator("#quizStart").click()
        page.wait_for_selector(case["wait"],state="visible",timeout=15000)
        if case.get("action")=="scroll-passport":
          page.locator(".v2-passport").scroll_into_view_if_needed()
        elif case.get("action")=="scroll-footer":
          page.locator(".site-footer").scroll_into_view_if_needed()
        page.wait_for_timeout(550)
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        page.wait_for_timeout(140)
        page.evaluate("window.scrollTo(0,0)")
        page.wait_for_timeout(140)
        raw=dest/(case["name"]+"-raw.png")
        final=dest/(case["name"]+".png")
        page.screenshot(path=str(raw),full_page=case.get("full_page",True),animations="disabled",caret="hide")
        normalize(raw).save(final,optimize=True)
        raw.unlink()
        results.append({"name":case["name"],"path":case["path"],"state":case["state"],"file":str(final)})
        context.close()
      browser.close()
    return results

def seed_approved_preview(base_url:str,baseline_dir:Path,production_dir:Path,approved:set[str]):
    unknown=approved-{case["name"] for case in CASES}
    if unknown:
      raise ValueError("unknown approved cases: "+", ".join(sorted(unknown)))
    current=OUT/"approved-seed-current"
    if current.exists(): shutil.rmtree(current)
    capture(base_url,current)
    if baseline_dir.exists(): shutil.rmtree(baseline_dir)
    baseline_dir.mkdir(parents=True,exist_ok=True)
    missing=[]
    manifest=[]
    for case in CASES:
      name=case["name"]
      source=(current if name in approved else production_dir)/(name+".png")
      if not source.exists():
        missing.append(name)
        continue
      target=baseline_dir/(name+".png")
      shutil.copy2(source,target)
      manifest.append({"name":name,"source":"approved-preview" if name in approved else "deployed-production"})
    (baseline_dir/"manifest.json").write_text(json.dumps(manifest,indent=2),encoding="utf-8")
    if missing:
      print(json.dumps({"missingBaselineCases":missing},indent=2))
      return 1
    print(json.dumps({"seeded":len(manifest),"approvedPreviewCases":sorted(approved)},indent=2))
    return 0

def compare(current_dir:Path,baseline_dir:Path):
    OUT.mkdir(exist_ok=True)
    results=[]
    for case in CASES:
      name=case["name"]
      current=normalize(current_dir/(name+".png"))
      baseline_path=baseline_dir/(name+".png")
      if not baseline_path.exists():
        results.append({"name":name,"failed":True,"reason":"missing approved baseline"})
        continue
      baseline=normalize(baseline_path)
      aspect_current=current.height/current.width
      aspect_base=baseline.height/baseline.width
      aspect_delta=abs(aspect_current-aspect_base)/aspect_base
      current=current.resize(baseline.size,Image.Resampling.LANCZOS)
      a=current.filter(ImageFilter.GaussianBlur(.7))
      b=baseline.filter(ImageFilter.GaussianBlur(.7))
      rgb=ImageChops.difference(a,b)
      gray=rgb.convert("L")
      hist=gray.histogram()
      changed=sum(hist[25:])/(baseline.width*baseline.height)
      mean=ImageStat.Stat(gray).mean[0]
      diff=gray.point(lambda px:min(255,px*5))
      diff_path=OUT/(name+"-diff.png")
      diff.save(diff_path)
      failed=aspect_delta>0.02 or mean>10.0 or (changed>0.02 and mean>4.0)
      results.append({"name":name,"changedPixelRatio":round(changed,6),"meanDifference":round(mean,3),"aspectRatioDelta":round(aspect_delta,6),"failed":failed,"diff":str(diff_path)})
    (OUT/"report.json").write_text(json.dumps(results,indent=2),encoding="utf-8")
    return results

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--mode",choices=("capture-production","seed-approved-preview","compare-preview","verify-masthead"),required=True)
    ap.add_argument("--baseline-dir",default=".visual-baselines")
    ap.add_argument("--production-baseline-dir",default=".visual-baselines-production")
    ap.add_argument("--approved-cases",default="")
    ap.add_argument("--production-base",default="https://enterwildones.com")
    ap.add_argument("--browser",choices=("chromium","webkit"),default="chromium")
    args=ap.parse_args()
    baseline=Path(args.baseline_dir)
    if args.mode=="capture-production":
      result=capture(args.production_base.rstrip("/"),baseline)
      print(json.dumps({"captured":result,"count":len(result)},indent=2))
      return 0

    server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base_url=f"http://127.0.0.1:{server.server_address[1]}"
    if args.mode=="seed-approved-preview":
      approved={x.strip() for x in args.approved_cases.split(",") if x.strip()}
      if not approved:
        server.shutdown();server.server_close()
        raise ValueError("--approved-cases is required for seed-approved-preview")
      try:
        return seed_approved_preview(base_url,baseline,Path(args.production_baseline_dir),approved)
      finally:
        server.shutdown();server.server_close()

    if args.mode=="verify-masthead":
      try:
        masthead=verify_mastheads(base_url,args.browser)
        print(json.dumps({"mastheadVerification":masthead},indent=2))
        return 1 if masthead["failures"] else 0
      finally:
        server.shutdown();server.server_close()

    masthead=verify_mastheads(base_url,"chromium")
    home_chrome=verify_home_chrome(base_url)
    ticket_credential=verify_ticket_credential_geometry(base_url)
    if masthead["failures"] or home_chrome["failures"] or ticket_credential["failures"]:
      server.shutdown();server.server_close()
      print(json.dumps({"mastheadVerification":masthead,"homeChromeVerification":home_chrome,"ticketCredentialVerification":ticket_credential},indent=2))
      return 1
    current=OUT/"current"
    try:
      capture(base_url,current)
    finally:
      server.shutdown();server.server_close()
    results=compare(current,baseline)
    failures=[r for r in results if r["failed"]]
    print(json.dumps({"cases":len(results),"failures":failures},indent=2))
    return 1 if failures else 0

if __name__=="__main__":sys.exit(main())
