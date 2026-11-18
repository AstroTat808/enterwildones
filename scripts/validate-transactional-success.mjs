import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = relative => readFile(new URL('../' + relative, import.meta.url), 'utf8');
const [application, invitation, styles, applyJs, inviteJs] = await Promise.all([
  'site/apply.html',
  'site/invite.html',
  'site/assets/css/transactional-success.css',
  'site/assets/js/apply.js',
  'site/assets/js/invite.js'
].map(read));
for (const html of [application, invitation]) {
  assert.match(html, /transactional-success\.css/);
  assert.match(html, /wo-success-panel hidden/);
  assert.match(html, /wo-success-icon/);
  assert.match(html, /wo-success-title/);
  assert.match(html, /wo-success-copy/);
  assert.match(html, /wo-success-actions/);
}
assert.match(styles, /@media\(max-width:560px\)/);
assert.match(styles, /prefers-reduced-motion/);
assert.match(application, /id="success"/);
assert.match(application, /data-success-event/);
assert.match(application, /aria-labelledby="applySuccessTitle"/);
assert.match(invitation, /id="granted"/);
assert.match(invitation, /data-granted-name/);
assert.match(invitation, /data-next-link/);
assert.match(invitation, /aria-labelledby="grantedTitle"/);
assert.match(applyJs, /getElementById\('success'\)\.classList\.remove\('hidden'\)/);
assert.match(inviteJs, /g\.classList\.remove\('hidden'\)/);
assert.match(inviteJs, /purchaseAvailable&&d\.nextUrl/);
console.log('Shared premium application and invitation success states validated.');
