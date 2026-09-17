import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const html = read('site/index.html').toString('utf8');
const css = read('site/assets/css/home.css').toString('utf8');
const js = read('site/assets/js/home-v2.js').toString('utf8');
const manifest = JSON.parse(read('site/assets/images/campaign/manifest.json'));

assert.equal(manifest.assets.length, 2);
assert.deepEqual(manifest.assets.map(asset => asset.name), ['portals-square', 'portals-landscape']);
const actualFiles = readdirSync(new URL('site/assets/images/campaign/', root)).sort();
const expectedFiles = ['manifest.json', ...manifest.assets.flatMap(asset => asset.files.map(file => file.path))].sort();
assert.deepEqual(actualFiles, expectedFiles, 'Campaign directory must contain the approved image set and manifest only.');
const approvedSources = {
  'portals-square': '114bcc6c86e5b908827c03d646b66a1d894001998fd93da16b282a3682318796',
  'portals-landscape': '5b032fb4641babec6df92f30464ba90e8fddc69196c2436956425c4a9fb2636f'
};
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
assert(html.includes('/assets/css/home.css'));
for (const legacy of [
  '/assets/css/home-v2.css',
  '/assets/css/home-v4.css',
  '/assets/css/home-hero-no-overlap.css',
  '/assets/css/home-mobile-polish.css',
  '/assets/css/home-mobile-final-tuning.css',
  '/assets/css/home-desktop-cleanup.css',
  '/assets/css/home-art-direction.css',
  '/assets/css/home-art-direction-v2.css',
  '/assets/css/home-realm-atmospheres.css',
  '/assets/css/home-premium.css',
  '/assets/css/home-mobile-logos.css',
  '/assets/css/campaign-hero.css',
  '/assets/css/brand-refresh.css'
]) assert(!html.includes(legacy), `Legacy homepage CSS still linked: ${legacy}`);
assert(html.includes('/assets/js/home-v2.js'));
assert(css.includes('prefers-reduced-motion'));
assert(css.includes('@media (max-width:1100px)'));
assert(css.includes('@media (max-width:860px)'));
assert(css.includes('#aureva::before'));
assert(css.includes('#halora::before'));
assert(css.includes('#sunveil::before'));
assert(css.includes('#nocturne::before'));
assert(js.includes('IntersectionObserver'));
assert(html.includes('class="v2-progress"'));
assert(html.includes('class="v2-passport'));
assert(html.includes('class="site-footer"'));
for (const realm of ['aureva','halora','sunveil','nocturne']) {
  assert(html.includes(`id="${realm}"`) && html.includes(`href="/events/${realm}"`));
  assert(html.includes(`/assets/images/realms/${realm}-1200.webp`));
}
assert(html.includes('/assets/images/realms/enter-wild-ones-1200.webp'));
assert(!/a new realm awakens|stay close|something extraordinary is coming/i.test(html));
console.log('Canonical homepage campaign verified: one homepage stylesheet, responsive breakpoints, Four Realms artwork, realm chapters, progress navigation, Passport CTA and motion safeguards.');
