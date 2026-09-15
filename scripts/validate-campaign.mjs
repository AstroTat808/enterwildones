import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const html = read('site/index.html').toString('utf8');
const manifest = JSON.parse(read('site/assets/images/campaign/manifest.json'));
assert.equal(manifest.assets.length, 2);
assert.deepEqual(manifest.assets.map(asset => asset.name), ['portals-square', 'portals-landscape']);
const actualFiles = readdirSync(new URL('site/assets/images/campaign/', root)).sort();
const expectedFiles = ['manifest.json', ...manifest.assets.flatMap(asset => asset.files.map(file => file.path))].sort();
assert.deepEqual(actualFiles, expectedFiles, 'Campaign directory must contain all eight approved image files and the manifest, with no unrelated files.');
assert(!html.includes('four-realms-worlds'), 'Superseded campaign artwork must not be referenced');
assert(html.includes('Some worlds call to you. Enter Wild Ones - The Four Realms.'));
assert(!/a new realm awakens|stay close|something extraordinary is coming/i.test(html), 'Removed bottom tagline must not survive in captions or metadata');
const approvedSources = {"portals-square": "114bcc6c86e5b908827c03d646b66a1d894001998fd93da16b282a3682318796", "portals-landscape": "122f41bb3637d688b78122f3822018cf0580a1bf3cedb1f0f1d43f1de10944c9"};
for (const asset of manifest.assets) {
  assert.equal(asset.sourceSha256, approvedSources[asset.name], 'Approved source artwork changed');
  for (const file of asset.files) {
    assert(!file.path.includes('/') && !file.path.includes('..'));
    assert(file.width > 0 && file.width <= asset.originalWidth, 'Do not upscale the approved artwork');
    assert(Math.abs(file.width / file.height - asset.originalWidth / asset.originalHeight) < .003, 'Preserve artwork proportions');
    const bytes = read(`site/assets/images/campaign/${file.path}`);
    assert.equal(bytes.length, file.bytes, `${file.path}: size mismatch`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${file.path}: checksum mismatch`);
    assert(html.includes(file.path), `${file.path}: responsive picture reference missing`);
    if (file.path.endsWith('.webp')) {
      assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
      assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
      assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
    } else {
      assert.equal(asset.sourceFormat, 'PNG', 'JPEG fallback must derive from the approved PNG source');
      assert.equal(bytes[0], 255); assert.equal(bytes[1], 216);
      assert.equal(bytes[bytes.length-2], 255); assert.equal(bytes[bytes.length-1], 217);
    }
  }
}
assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1);
assert(html.includes('<picture class="campaign-picture">'));
assert(html.includes('fetchpriority="high"'));
assert(html.includes('/assets/css/campaign-hero.css'));
assert(!html.includes('class="hero-logo-wrap'));
assert(html.includes('class="site-footer"'));
for (const realm of ['aureva','halora','sunveil','nocturne']) {
  assert(html.includes(`id="${realm}"`) && html.includes(`href="/events/${realm}"`));
}
console.log('Campaign verified: eight intact image files, responsive picture, one H1, and preserved realms/footer.');
