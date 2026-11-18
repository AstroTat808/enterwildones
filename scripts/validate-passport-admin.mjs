import { readFile } from 'node:fs/promises';const fail=m=>{throw new Error(m)};const files={auth:'../netlify/functions/_passport-auth.mjs',request:'../netlify/functions/passport-request.mjs',verify:'../netlify/functions/passport-verify.mjs',passport:'../netlify/functions/passport.mjs',admin:'../netlify/functions/admin-overview.mjs',html:'../site/passport.html',js:'../site/assets/js/passport.js',premium:'../site/assets/css/transactional-premium.css',netlify:'../netlify.toml',migration:'../netlify/database/migrations/002_passport-auth/migration.sql'};const t={};for(const[k,p]of Object.entries(files))t[k]=await readFile(new URL(p,import.meta.url),'utf8');for(const n of ['@neondatabase/serverless','DATABASE_URL','new Pool','pool.end()','BEGIN','COMMIT','ROLLBACK','wildones-passport-magic','wildones-passport-session','FOR UPDATE','consumed_at'])if(!t.auth.includes(n))fail(`Passport auth invariant missing: ${n}`);for(const n of ['verifyTurnstile',"'passport_login'",'If a Wild Ones Passport exists'])if(!t.request.includes(n))fail(`Passport request invariant missing: ${n}`);if(!t.verify.includes('consumeMagicLink')||!t.verify.includes('passportCookie'))fail('Passport verify flow missing.');for(const n of ['readPassportSession','STORES.tickets','STORES.entitlements','checkedIn'])if(!t.passport.includes(n))fail(`Passport data boundary missing: ${n}`);if(!t.admin.includes('isAdmin')||!t.admin.includes('admissionRevenueCents')||!t.admin.includes('addonRevenueCents'))fail('Master admin boundary missing.');if(!t.js.includes('/api/passport/config')||!t.js.includes('turnstile.render'))fail('Passport runtime Turnstile config missing.');for(const n of ['completionStorageKey','MASTER CYCLE','data-master-cycle','realm-complete-overlay','buildMasterCycleCeremony','Continue to Passport','THE CYCLE REMEMBERS.'])if(!t.js.includes(n))fail(`Passport progression experience missing: ${n}`);for(const n of ['Four Realms seal','passport-master-card','passportRealmUnlock','passportMasterUnlock','Full-screen cinematic Master Cycle unlock ceremony','master-cycle-orbit','masterCycleCoreAwaken'])if(!t.premium.includes(n))fail(`Passport premium progression style missing: ${n}`);if(!t.netlify.includes('/admin/overview')||!t.netlify.includes('/passport*'))fail('Passport/admin routes or headers missing.');if(!t.migration.includes('wildones_passport_magic_links'))fail('Passport auth migration missing.');console.log('Validated Passport one-time authentication, attendee aggregation, master admin auth, runtime Turnstile, and private routing.');

const { renderPassportSignInEmail } = await import('../netlify/functions/_mail-templates.mjs');
const readPassport = async path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [confirmHtml, confirmCss, requestJs, clientJs] = await Promise.all([
  'site/passport-check-email.html',
  'site/assets/css/passport-check-email.css',
  'netlify/functions/passport-request.mjs',
  'site/assets/js/passport.js'
].map(readPassport));
const expectedRoute = 'from = "/passport/check-email"';
if (!t.netlify.includes(expectedRoute) || !t.netlify.includes('to = "/passport-check-email.html"'))
  fail('Passport confirmation route missing.');
for (const snippet of ['Check your inbox.', '15-minute access', 'spam or promotions', 'href="/passport"', 'noindex,nofollow,noarchive']) {
  if (!confirmHtml.includes(snippet)) fail('Passport confirmation is missing: ' + snippet);
}
if (!confirmCss.includes('@media(max-width:600px)')) fail('Responsive Passport confirmation styling missing.');
if (!clientJs.includes("window.location.assign('/passport/check-email')"))
  fail('Successful Passport sign-in requests must navigate to confirmation.');
if (!clientJs.includes("if(!r.ok)throw new Error"))
  fail('Failed Passport requests must remain on the form.');
if (!requestJs.includes('renderPassportSignInEmail') || !requestJs.includes('html:mail.html') || !requestJs.includes('text:mail.text'))
  fail('Passport endpoint must send both branded HTML and text fallback.');
const signInUrl = 'https://enterwildones.com/passport/verify?token=private-example-token';
const signInMail = renderPassportSignInEmail({ link: signInUrl });
for (const part of ['ENTER WILD ONES', 'Open Your Passport', '15 minutes', 'enter-wild-ones-email.png', 'enter-wild-ones-1200.webp'])
  if (!signInMail.html.includes(part)) fail('Branded Passport email is missing: ' + part);
if (!signInMail.html.includes('href="' + signInUrl + '"'))
  fail('Branded Passport sign-in action must use the provided one-time link.');
if (!signInMail.text.includes(signInUrl))
  fail('Passport sign-in plain text fallback must contain the secure link.');
if (confirmHtml.includes('private-example-token') || confirmHtml.includes('c@sibel.org'))
  fail('Confirmation must not expose private sign-in details.');
for (const badUrl of ['http://attacker.example/passport/verify?token=a', 'https://enterwildones.com/passport', 'https://enterwildones.com/passport/verify'])
  try { renderPassportSignInEmail({ link: badUrl }); fail('Invalid Passport URL accepted: ' + badUrl); }
  catch (error) { if (String(error.message).startsWith('Invalid Passport URL accepted')) throw error; }
console.log('Validated Passport confirmation, navigation, and branded HTML/text sign-in email.');
