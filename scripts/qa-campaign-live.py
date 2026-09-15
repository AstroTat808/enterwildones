"""Verify deployed campaign bytes and responsive layout without account writes.

QA_BASE_URL must be the production site or a numbered Netlify deploy preview.
Run after npm run build with Playwright browsers and Pillow installed.
"""
import hashlib
import io
import json
import os
import pathlib
import re
import subprocess
import time
import urllib.request
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'campaign-qa'
OUT.mkdir(exist_ok=True)
BASE = os.environ.get('QA_BASE_URL', 'https://enterwildones.com').rstrip('/')
assert re.fullmatch(r'https://(?:enterwildones\.com|deploy-preview-[0-9]+--enterwildones\.netlify\.app)', BASE), 'Unapproved QA host'
SHA = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
REPORT = {'baseUrl': BASE, 'checkedCommit': SHA, 'readOnly': True, 'assets': [], 'results': []}
MANIFEST = json.loads((ROOT / 'site/assets/images/campaign/manifest.json').read_text())
VIEWPORTS = [(320,740,1),(375,812,1),(390,844,3),(393,852,1),(430,932,1),
             (700,1000,1),(701,1000,1),(768,1024,1),(844,390,1),
             (1024,768,1),(1440,1000,1),(1920,1080,1)]


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def fetch(path):
    request = urllib.request.Request(BASE + path, headers={'Cache-Control':'no-cache', 'User-Agent':'WildOnes-ReadOnly-Campaign-QA'})
    with urllib.request.urlopen(request, timeout=25) as response:
        check(urlparse(response.url).netloc == urlparse(BASE).netloc, 'Unexpected asset redirect')
        return response.read(), response.headers.get_content_type()


def hero(html):
    match = re.search(r'<section class="campaign-hero"[\s\S]*?</section>', html)
    check(match is not None, 'Campaign hero not deployed')
    return re.sub(r'\s+', ' ', match.group(0)).strip()


def wait_for_release():
    expected = (ROOT / 'site/index.html').read_text()
    css = (ROOT / 'site/assets/css/campaign-hero.css').read_bytes()
    deadline = time.monotonic() + 360
    last = None
    while time.monotonic() < deadline:
        try:
            deployed, _ = fetch('/?campaign-qa=' + SHA)
            check(hero(deployed.decode()) == hero(expected), 'Deployed hero differs from checked commit')
            actual, _ = fetch('/assets/css/campaign-hero.css')
            check(actual == css, 'Deployed campaign CSS differs from checked commit')
            REPORT['heroMarkupMatched'] = True
            REPORT['campaignCssMatched'] = True
            return
        except Exception as error:
            last = str(error)
            time.sleep(10)
    raise AssertionError('Deployment did not become ready: ' + str(last))


def verify_assets():
    remote_manifest, _ = fetch('/assets/images/campaign/manifest.json')
    check(json.loads(remote_manifest) == MANIFEST, 'Deployed manifest differs from approved manifest')
    for asset in MANIFEST['assets']:
        for item in asset['files']:
            path = '/assets/images/campaign/' + item['path']
            data, mime = fetch(path)
            check(len(data) == item['bytes'], path + ': byte count differs')
            check(hashlib.sha256(data).hexdigest() == item['sha256'], path + ': SHA-256 differs')
            check(data == (ROOT / ('site' + path)).read_bytes(), path + ': checkout/deploy differ')
            with Image.open(io.BytesIO(data)) as image:
                image.load()
                check(image.size == (item['width'], item['height']), path + ': dimensions differ')
            expected_mime = 'image/webp' if path.endswith('.webp') else 'image/jpeg'
            check(mime == expected_mime, path + ': incorrect content type')
            REPORT['assets'].append({'path':path, 'bytes':len(data), 'sha256':item['sha256'], 'decoded':True, 'mime':mime})


def overlap(a, b):
    return a['x'] < b['right']-1 and a['right'] > b['x']+1 and a['y'] < b['bottom']-1 and a['bottom'] > b['y']+1


def read_only(route):
    if route.request.method in ('GET', 'HEAD', 'OPTIONS'):
        route.continue_()
    else:
        route.abort()


def matrix():
    with sync_playwright() as playwright:
        for engine in ('chromium', 'webkit'):
            browser = getattr(playwright, engine).launch()
            for width, height, dpr in VIEWPORTS:
                context = browser.new_context(viewport={'width':width,'height':height}, device_scale_factor=dpr,
                    is_mobile=width<900, has_touch=width<900, reduced_motion='reduce')
                context.route('**/*', read_only)
                page = context.new_page()
                errors, failed, requests = [], [], []
                page.on('pageerror', lambda error, target=errors: target.append(str(error)))
                page.on('request', lambda request, target=requests: target.append(request.url))
                page.on('response', lambda response, target=failed: target.append(response.url) if response.status>=400 and '/assets/' in response.url else None)
                row = {'engine':engine, 'width':width, 'height':height, 'dpr':dpr, 'javascript':True}
                try:
                    response = page.goto(BASE + '/', wait_until='domcontentloaded', timeout=45000)
                    check(response.status == 200, 'Homepage failed')
                    page.wait_for_function("document.querySelector('link[data-wild-ones-retina]')?.sheet && document.querySelector('link[data-wild-ones-polish]')?.sheet")
                    page.locator('.campaign-image').evaluate('(image)=>image.decode()')
                    page.wait_for_timeout(500)
                    info = page.evaluate('''() => {
                      const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
                      const image=document.querySelector('.campaign-image');
                      return {source:image.currentSrc,natural:[image.naturalWidth,image.naturalHeight],image:rect(image),bar:rect(document.querySelector('.topbar')),intro:rect(document.querySelector('.campaign-intro')),fit:getComputedStyle(image).objectFit,overflow:document.documentElement.scrollWidth>innerWidth+1,h1:document.querySelectorAll('h1').length,buttons:[...document.querySelectorAll('.campaign-actions a')].map(rect),realmCount:document.querySelectorAll('.realm-cinematic').length};
                    }''')
                    ratio = 1 if width <= 700 else 1672/941
                    check(('portals-wide-' in info['source']) == (width > 700), 'Wrong composition at breakpoint')
                    check(info['source'].endswith('.webp'), 'WebP selection failed')
                    check(abs(info['image']['width']/info['image']['height']-ratio)<.01, 'Displayed ratio differs')
                    check(abs(info['natural'][0]/info['natural'][1]-ratio)<.01, 'Selected source ratio differs')
                    check(info['fit']=='contain', 'Artwork cropping enabled')
                    check(info['image']['y']>=info['bar']['bottom']-1, 'Header overlaps artwork')
                    check(info['intro']['y']>=info['image']['bottom']-1, 'Action row overlaps artwork')
                    check(not info['overflow'], 'Horizontal overflow')
                    check(info['h1']==1 and info['realmCount']==4, 'Heading/realm regression')
                    check(all(button['height']>=44 for button in info['buttons']), 'Action touch target too small')
                    downloads={url for url in requests if '/assets/images/campaign/' in url}
                    check(len(downloads)==1, 'Both campaign compositions downloaded')
                    if width in (375,390,430,768,1440,1920):
                        page.locator('.campaign-hero').screenshot(path=str(OUT/f'{engine}-{width}-hero.png'), scale='css')
                    page.evaluate('window.scrollTo(0,0)')
                    if page.locator('.mobile-menu summary').is_visible():
                        page.locator('.mobile-menu summary').click()
                        check(page.locator('.mobile-menu').get_attribute('open') is not None, 'Mobile menu did not open')
                        page.keyboard.press('Escape')
                        check(page.locator('.mobile-menu').get_attribute('open') is None, 'Mobile menu did not close')
                    page.locator('.campaign-actions a[href="#realms"]').click()
                    check(page.url.endswith('#realms'), 'Explore action failed')
                    page.locator('.site-footer').scroll_into_view_if_needed()
                    page.locator('.footer-brand img').evaluate('(image)=>image.decode()')
                    footer = page.evaluate('''() => {
                      const f=document.querySelector('.site-footer');const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
                      return {container:rect(f),image:rect(f.querySelector('img')),nav:rect(f.querySelector('nav')),legal:rect(f.querySelector(':scope > span'))};
                    }''')
                    for first, second in [('image','nav'),('image','legal'),('nav','legal')]:
                        check(not overlap(footer[first], footer[second]), 'Footer overlap: '+first+'/'+second)
                    check(footer['image']['y']>=footer['container']['y']-1, 'Footer logo escaped container')
                    check(not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'), 'Overflow after scrolling')
                    if width in (390,1440):
                        page.locator('.site-footer').screenshot(path=str(OUT/f'{engine}-{width}-footer.png'), scale='css')
                    page.locator('.campaign-actions a[href="/invite"]').click()
                    page.wait_for_url('**/invite', timeout=30000)
                    check(page.locator('main').is_visible(), 'Invitation action did not reach page')
                    check(not failed, 'Failed assets: '+str(failed))
                    check(not errors, 'Browser errors: '+str(errors))
                    row.update(status='passed', source=info['source'], campaignDownloads=len(downloads))
                except Exception as error:
                    row.update(status='failed', error=str(error))
                    try:
                        page.screenshot(path=str(OUT/f'{engine}-{width}-failure.png'), scale='css')
                    except Exception:
                        pass
                finally:
                    REPORT['results'].append(row)
                    context.close()
            for width in (390,1440):
                context = browser.new_context(viewport={'width':width,'height':1000}, java_script_enabled=False)
                context.route('**/*', read_only)
                page = context.new_page()
                row = {'engine':engine,'width':width,'javascript':False}
                try:
                    response = page.goto(BASE+'/',wait_until='load',timeout=45000)
                    check(response.status==200, 'No-JS page failed')
                    check(page.locator('.campaign-image').is_visible(), 'No-JS artwork missing')
                    check(page.locator('.campaign-actions a[href="#realms"]').is_visible(), 'No-JS action missing')
                    image = page.locator('.campaign-image').evaluate('(image)=>({loaded:image.complete&&image.naturalWidth>0,source:image.currentSrc})')
                    check(image['loaded'], 'No-JS image did not decode')
                    check(('portals-wide-' in image['source']) == (width>700), 'No-JS composition differs')
                    check(not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'), 'No-JS horizontal overflow')
                    row.update(status='passed', source=image['source'])
                except Exception as error:
                    row.update(status='failed',error=str(error))
                finally:
                    REPORT['results'].append(row)
                    context.close()
            browser.close()


try:
    wait_for_release()
    verify_assets()
    matrix()
except Exception as error:
    REPORT['fatalError'] = str(error)
finally:
    failures = [row for row in REPORT['results'] if row['status']!='passed']
    REPORT['passed'] = len(REPORT['results']) == 28 and not failures and not REPORT.get('fatalError')
    (OUT/'report.json').write_text(json.dumps(REPORT, indent=2)+'\n')
    print(json.dumps({'assets':len(REPORT['assets']), 'checks':len(REPORT['results']), 'passed':REPORT['passed'], 'failures':failures, 'fatalError':REPORT.get('fatalError')},indent=2))
if not REPORT['passed']:
    raise SystemExit(1)
