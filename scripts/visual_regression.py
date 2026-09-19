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
 {"name":"masthead-home-phone","path":"/","state":"home","viewport":(390,844),"dpr":2,"wait":".topbar .brand-label","full_page":False},
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
 ("320",320,568,2),("390",390,844,2),("768",768,1024,2),
 ("1024",1024,768,1),("1440",1440,1000,1),("1920",1920,1080,1),
]
MASTHEAD_ROUTES=[
 ("home","/","home"),
 ("event","/events/aureva","plain"),
 ("quiz","/find-your-realm","plain"),
 ("passport","/passport","passport-login"),
 ("invite","/invite","plain"),
 ("apply","/apply/aureva","apply-aureva"),
]

ROUTES={
 "/":"index.html",
 "/find-your-realm":"find-your-realm.html",
 "/events/aureva":"events/aureva.html",
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

def verify_mastheads(base_url:str):
    OUT.mkdir(exist_ok=True)
    rows=[];failures=[]
    desktop_reference={}
    with sync_playwright() as p:
      browser=p.chromium.launch()
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
            initial=page.evaluate("""() => {
 const r=e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:b.x,y:b.y,w:b.width,h:b.height,font:s.fontSize,tracking:s.letterSpacing,display:s.display,visibility:s.visibility,opacity:+s.opacity}};
 const header=document.querySelector('.topbar'),brand=header?.querySelector('.brand'),icon=header?.querySelector('.brand-icon'),label=header?.querySelector('.brand-label'),sub=label?.querySelector('span');
 const hs=header?getComputedStyle(header):null;
 return {header:r(header),brand:r(brand),icon:r(icon),label:r(label),sub:r(sub),labelText:(label?.childNodes?.[0]?.textContent||'').trim(),subText:(sub?.textContent||'').trim(),blur:hs?.backdropFilter||hs?.webkitBackdropFilter||'',shadow:hs?.boxShadow||''};
}""")
            def clipped(child,parent,tol=1.5):
              return child["y"]<parent["y"]-tol or child["y"]+child["h"]>parent["y"]+parent["h"]+tol
            if initial["labelText"]!="ENTER WILD ONES":row["failures"].append("ENTER WILD ONES wordmark missing")
            if initial["subText"]!="THE FOUR REALMS":row["failures"].append("THE FOUR REALMS wordmark missing")
            if clipped(initial["icon"],initial["header"]):row["failures"].append("emblem clipped in expanded header")
            if clipped(initial["brand"],initial["header"]):row["failures"].append("brand lockup clipped in expanded header")
            if initial["label"]["w"]<=0 or initial["sub"]["w"]<=0:row["failures"].append("wordmark not visible")
            desktop_signature={k:round(initial[k2][k3],2) if isinstance(initial[k2][k3],(int,float)) else initial[k2][k3] for k,k2,k3 in [("iconW","icon","w"),("iconH","icon","h"),("labelFont","label","font"),("labelTracking","label","tracking"),("subFont","sub","font"),("subTracking","sub","tracking")]}
            if w>=1024:
              ref=desktop_reference.get(vp)
              if ref is None:desktop_reference[vp]=desktop_signature
              elif desktop_signature!=ref:row["failures"].append("desktop masthead physical dimensions differ from "+str(ref)+" got "+str(desktop_signature))
            page.evaluate("document.body.classList.add('masthead-scrolled')")
            page.wait_for_timeout(430)
            compact=page.evaluate("""() => {
 const r=e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:b.x,y:b.y,w:b.width,h:b.height,font:s.fontSize,tracking:s.letterSpacing,display:s.display,visibility:s.visibility,opacity:+s.opacity}};
 const header=document.querySelector('.topbar'),brand=header?.querySelector('.brand'),icon=header?.querySelector('.brand-icon'),label=header?.querySelector('.brand-label'),sub=label?.querySelector('span');
 const hs=header?getComputedStyle(header):null;
 return {header:r(header),brand:r(brand),icon:r(icon),label:r(label),sub:r(sub),labelText:(label?.childNodes?.[0]?.textContent||'').trim(),subText:(sub?.textContent||'').trim(),blur:hs?.backdropFilter||hs?.webkitBackdropFilter||'',shadow:hs?.boxShadow||''};
}""")
            if compact["header"]["h"]>=initial["header"]["h"]-1:row["failures"].append("masthead did not compact")
            if clipped(compact["icon"],compact["header"]):row["failures"].append("emblem clipped in compact header")
            if clipped(compact["brand"],compact["header"]):row["failures"].append("brand lockup clipped in compact header")
            if compact["labelText"]!="ENTER WILD ONES" or compact["subText"]!="THE FOUR REALMS":row["failures"].append("wordmark disappears in compact header")
            if compact["label"]["w"]<=0 or compact["sub"]["w"]<=0:row["failures"].append("compact wordmark not visible")
            if compact["blur"]==initial["blur"]:row["failures"].append("premium blur does not change on compact header")
            if compact["shadow"]==initial["shadow"]:row["failures"].append("premium shadow does not change on compact header")
            row["expanded"]=initial;row["compact"]=compact
          except Exception as e:
            row["failures"].append(str(e))
          if row["failures"]:failures.append({"viewport":vp,"route":name,"issues":row["failures"]})
          rows.append(row);page.close();context.close()
      browser.close()
    report={"viewports":[x[0] for x in MASTHEAD_VIEWPORTS],"routes":[x[0] for x in MASTHEAD_ROUTES],"desktopReference":desktop_reference,"failures":failures,"checks":len(rows)}
    (OUT/"masthead-geometry.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    return report

def verify_home_chrome(base_url:str):
    failures=[];rows=[]
    viewports=[("320",320,568,2),("390",390,844,2),("768",768,1024,2),("1024",1024,768,1),("1440",1440,1000,1),("1920",1920,1080,1)]
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
            if not hb or hb["h"]<124:row["issues"].append("header below 124px")
            if not ib or ib["w"]<140 or ib["h"]<108:row["issues"].append("emblem below desktop minimum")
            if not fb or fb["h"]>82:row["issues"].append("footer above 82px")
            if not fl or fl["w"]>52 or fl["h"]>52:row["issues"].append("footer logo above 52px")
          elif w>=700:
            if not hb or hb["h"]<102:row["issues"].append("tablet header below 102px")
            if not ib or ib["w"]<80:row["issues"].append("tablet emblem below 80px")
            if not fb or fb["h"]>104:row["issues"].append("tablet footer above 104px")
          else:
            if not hb or hb["h"]<96:row["issues"].append("mobile header below 96px")
            if not ib or ib["w"]<68:row["issues"].append("mobile emblem below 68px")
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
    ap.add_argument("--mode",choices=("capture-production","seed-approved-preview","compare-preview"),required=True)
    ap.add_argument("--baseline-dir",default=".visual-baselines")
    ap.add_argument("--production-baseline-dir",default=".visual-baselines-production")
    ap.add_argument("--approved-cases",default="")
    ap.add_argument("--production-base",default="https://enterwildones.com")
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

    masthead=verify_mastheads(base_url)
    home_chrome=verify_home_chrome(base_url)
    if masthead["failures"] or home_chrome["failures"]:
      server.shutdown();server.server_close()
      print(json.dumps({"mastheadVerification":masthead,"homeChromeVerification":home_chrome},indent=2))
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
