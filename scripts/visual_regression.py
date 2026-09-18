#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, sys, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from PIL import Image, ImageChops, ImageFilter, ImageStat
from playwright.sync_api import sync_playwright
import production_visual_qa as qa

ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/"site"
OUT=ROOT/"visual-regression-results"

CASES=[
 {"name":"home-desktop","path":"/","state":"home","viewport":(1440,1000),"dpr":1,"wait":"main"},
 {"name":"passport-auth-desktop","path":"/passport","state":"passport","viewport":(1440,1000),"dpr":1,"wait":"#account:not([hidden])"},
 {"name":"admin-overview-desktop","path":"/admin/overview","state":"overview","viewport":(1440,1000),"dpr":1,"wait":"#events .event"},
 {"name":"check-in-phone","path":"/check-in","state":"check-in","viewport":(390,844),"dpr":2,"wait":"#gate:not([hidden])"},
]
ROUTES={"/":"index.html","/passport":"passport.html","/admin/overview":"admin-overview.html","/check-in":"check-in.html"}

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
        page.wait_for_selector(case["wait"],state="visible",timeout=15000)
        page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        page.wait_for_timeout(120)
        page.evaluate("window.scrollTo(0,0)")
        page.wait_for_timeout(120)
        raw=dest/(case["name"]+"-raw.png")
        final=dest/(case["name"]+".png")
        page.screenshot(path=str(raw),full_page=True,animations="disabled",caret="hide")
        normalize(raw).save(final,optimize=True)
        raw.unlink()
        results.append({"name":case["name"],"path":case["path"],"file":str(final)})
        context.close()
      browser.close()
    return results

def compare(current_dir:Path,baseline_dir:Path):
    OUT.mkdir(exist_ok=True)
    results=[]
    for case in CASES:
      name=case["name"]
      current=normalize(current_dir/(name+".png"))
      baseline=normalize(baseline_dir/(name+".png"))
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
    ap.add_argument("--mode",choices=("capture-production","compare-preview"),required=True)
    ap.add_argument("--baseline-dir",default=".visual-baselines")
    ap.add_argument("--production-base",default="https://enterwildones.com")
    args=ap.parse_args()
    baseline=Path(args.baseline_dir)
    if args.mode=="capture-production":
      result=capture(args.production_base.rstrip("/"),baseline)
      print(json.dumps({"captured":result},indent=2))
      return 0

    server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    current=OUT/"current"
    try:
      capture(f"http://127.0.0.1:{server.server_address[1]}",current)
    finally:
      server.shutdown();server.server_close()
    results=compare(current,baseline)
    failures=[r for r in results if r["failed"]]
    print(json.dumps({"cases":len(results),"failures":failures},indent=2))
    return 1 if failures else 0

if __name__=="__main__":sys.exit(main())
