#!/usr/bin/env python3
from __future__ import annotations
import base64, json, sys, threading, zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
from PIL import Image, ImageChops, ImageFilter, ImageStat
from playwright.sync_api import sync_playwright

import production_visual_qa as qa

ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/"site"
BASELINE_B64=ROOT/"tests"/"visual-baselines.zip.b64"
OUT=ROOT/"visual-regression-results"

CASES=[
 {"name":"home-desktop","path":"/","state":"home","viewport":(1440,1000),"dpr":1,"wait":"main"},
 {"name":"passport-auth-desktop","path":"/passport","state":"passport","viewport":(1440,1000),"dpr":1,"wait":"#account:not([hidden])"},
 {"name":"admin-overview-desktop","path":"/admin/overview","state":"overview","viewport":(1440,1000),"dpr":1,"wait":"#events .event"},
 {"name":"check-in-phone","path":"/check-in","state":"check-in","viewport":(390,844),"dpr":2,"wait":"#gate:not([hidden])"},
]

ROUTES={
 "/":"index.html",
 "/passport":"passport.html",
 "/admin/overview":"admin-overview.html",
 "/check-in":"check-in.html",
}

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
    def translate_path(self,path):
        clean=urlparse(path).path
        if clean in ROUTES:
            return str(SITE/ROUTES[clean])
        target=(SITE/clean.lstrip("/")).resolve()
        if SITE.resolve() not in target.parents and target!=SITE.resolve():
            return str(SITE/"404.html")
        return str(target)

def unpack_baselines():
    raw=base64.b64decode(BASELINE_B64.read_text(encoding="ascii"))
    z=zipfile.ZipFile(BytesIO(raw))
    dest=OUT/"baselines";dest.mkdir(parents=True,exist_ok=True)
    z.extractall(dest)
    return dest

def compare(current_path,baseline_path,diff_path):
    current=Image.open(current_path).convert("RGB")
    baseline=Image.open(baseline_path).convert("RGB")
    height_delta=abs((current.height/current.width)-(baseline.height/baseline.width))/(baseline.height/baseline.width)
    current=current.resize(baseline.size,Image.Resampling.LANCZOS)
    a=current.filter(ImageFilter.GaussianBlur(.7))
    b=baseline.filter(ImageFilter.GaussianBlur(.7))
    diff=ImageChops.difference(a,b)
    gray=diff.convert("L")
    hist=gray.histogram()
    changed=sum(hist[25:])/(baseline.width*baseline.height)
    mean=ImageStat.Stat(gray).mean[0]
    amplified=gray.point(lambda p:min(255,p*5))
    amplified.save(diff_path)
    failed=height_delta>0.02 or changed>0.02 or mean>10.0
    return {"changedPixelRatio":round(changed,6),"meanDifference":round(mean,3),"aspectRatioDelta":round(height_delta,6),"failed":failed}

def main():
    OUT.mkdir(exist_ok=True)
    baseline_dir=unpack_baselines()
    server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base=f"http://127.0.0.1:{server.server_address[1]}"
    results=[]
    try:
      with sync_playwright() as p:
        browser=p.chromium.launch()
        for case in CASES:
          w,h=case["viewport"]
          context=browser.new_context(viewport={"width":w,"height":h},device_scale_factor=case["dpr"],is_mobile=w<900,has_touch=w<900,color_scheme="dark",reduced_motion="reduce")
          page=context.new_page()
          qa.fixtures(page,case["state"])
          page.goto(base+case["path"],wait_until="domcontentloaded",timeout=30000)
          page.wait_for_selector(case["wait"],state="visible",timeout=15000)
          page.wait_for_timeout(500)
          page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
          page.wait_for_timeout(120)
          page.evaluate("window.scrollTo(0,0)")
          page.wait_for_timeout(120)
          current=OUT/(case["name"]+"-current.png")
          diff=OUT/(case["name"]+"-diff.png")
          page.screenshot(path=str(current),full_page=True,animations="disabled",caret="hide")
          result=compare(current,baseline_dir/(case["name"]+".png"),diff)
          result.update(name=case["name"],path=case["path"],current=str(current),baseline=str(baseline_dir/(case["name"]+".png")),diff=str(diff))
          results.append(result)
          context.close()
        browser.close()
    finally:
      server.shutdown();server.server_close()
    (OUT/"report.json").write_text(json.dumps(results,indent=2),encoding="utf-8")
    failures=[r for r in results if r["failed"]]
    print(json.dumps({"cases":len(results),"failures":failures},indent=2))
    return 1 if failures else 0

if __name__=="__main__":sys.exit(main())
