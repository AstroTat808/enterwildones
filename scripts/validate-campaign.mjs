import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const html = read('site/index.html').toString('utf8');
const css = read('site/assets/css/home-v2.css').toString('utf8');
const js = read('site/assets/js/home-v2.js').toString('utf8');
const manifest = JSON.parse(read('site/assets/images/campaign/manifest.json'));

// Keep the approved campaign source bytes immutable while the V2 page changes
// how the landscape composition is presented.
assert.equal(manifest.assets.length, 2);
assert.deepEqual(manifest.assets.map(asset => asset.name), ['portals-square', 'portals-landscape']);
const actualFiles = readdirSync(new URL('site/assets/images/campaign/', root)).sort();
const expectedFiles = ['manifest.json', ...manifest.assets.flatMap(asset => asset.files.map(file => file.path))].sort();
assert.deepEqual(actualFiles, expectedFiles, 'Campaign directory must contain the approved image set and manifest only.');
const approvedSources = {"portals-square": "114bcc6c86e5b908827c03d646b66a1d894001998fd93da16b282a3682318796", "portals-landscape": "122f41bb3637d688b78122f3822018cf0580a1bf3cedb1f0f1d43f1de10944c9"};
for (const asset of manifest.assets) {
  assert.equal(asset.sourceSha256, approvedSources[asset.name], 'Approved source artwork changed');
  for (const file of asset.files) {
    assert(!file.path.includes('/') && !file.path.includes('..'));
    assert(file.width > 0 && file.width <= asset.originalWidth);
    assert(Math.abs(file.width / file.height - asset.originalWidth / asset.originalHeight) < .003);
    const bytes = read(`site/assets/images/campaign/${file.path}`);
    assert.equal(bytes.length, file.bytes, `${file.path}: size mismatch`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${file.path}: checksum mismatch`);
  }
}

assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, 'Homepage keeps one H1');
assert(html.includes('class="v2-hero"'));
assert(html.includes('class="v2-hero-media"'));
assert(html.includes('four-realms-portals-wide-960.webp'));
assert(html.includes('four-realms-portals-wide-1280.webp'));
assert(html.includes('four-realms-portals-wide-1672.webp'));
assert(html.includes('four-realms-portals-wide.jpg'));
assert(html.includes('fetchpriority="high"'));
assert(html.includes('/assets/css/home-v2.css'));
assert(html.includes('/assets/js/home-v2.js'));
assert(!html.includes('/assets/css/campaign-hero.css'));
assert(!html.includes('/assets/css/home-premium.css'));
assert(!html.includes('/assets/css/home-mobile-logos.css'));
assert(!html.includes('/assets/css/brand-refresh.css'));
assert(css.includes('prefers-reduced-motion'));
assert(js.includes('IntersectionObserver'));
assert(html.includes('class="v2-progress"'));
assert(html.includes('class="v2-passport'));
assert(html.includes('class="site-footer"'));
for (const realm of ['aureva','halora','sunveil','nocturne']) {
  assert(html.includes(`id="${realm}"`) && html.includes(`href="/events/${realm}"`));
  assert(html.includes(`/assets/images/realms/${realm}.svg`));
}
assert(!/a new realm awakens|stay close|something extraordinary is coming/i.test(html));
console.log('V2 campaign verified: immutable approved artwork, cinematic hero, four realm chapters, progress navigation, Passport CTA and responsive motion safeguards.');
