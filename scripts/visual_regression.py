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

ROUTES={
 "/":"index.html",
 "/find-your-realm":"find-your-realm.html",
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

def seed_approved_preview(base_url:str,baseline_dir:Path,legacy_dir:Path,approved:set[str]):
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
      source=(current if name in approved else legacy_dir)/(name+".png")
      if not source.exists():
        missing.append(name)
        continue
      target=baseline_dir/(name+".png")
      shutil.copy2(source,target)
      manifest.append({"name":name,"source":"approved-preview" if name in approved else "legacy-v4"})
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
    ap.add_argument("--legacy-baseline-dir",default=".visual-baselines-v4")
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
        return seed_approved_preview(base_url,baseline,Path(args.legacy_baseline_dir),approved)
      finally:
        server.shutdown();server.server_close()

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
