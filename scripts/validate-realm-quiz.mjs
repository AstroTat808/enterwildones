import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const html=read('site/find-your-realm.html');
const js=read('site/assets/js/realm-quiz.js');
const css=read('site/assets/css/realm-quiz.css');
const netlify=read('netlify.toml');
const home=read('site/index.html');

for(const needle of ['Which realm','quizStart','quizStage','quizResult','resultExplore','quizShare','quizRetake'])assert(html.includes(needle),`Quiz markup missing ${needle}`);
for(const realm of ['AUREVA','HALORA','SUNVEIL','NOCTURNE'])assert(js.includes(`name:'${realm}'`),`Quiz missing result ${realm}`);
for(const key of ['light','balance','fire','night'])assert(js.includes(`${key}:`),`Quiz scoring missing ${key}`);
assert(js.includes('questions=[') && js.includes('selections=[]'),'Quiz question/scoring engine missing');
assert(js.includes("url.searchParams.set('realm'"),'Shareable result URL missing');
assert(js.includes('navigator.share') && js.includes('navigator.clipboard'),'Share fallback missing');
assert(html.includes('does not affect invitations, applications, Passport access or ticket eligibility'),'Quiz must remain explicitly non-gating');
assert(css.includes('@media(max-width:760px)'),'Quiz mobile layout missing');
assert(css.includes('prefers-reduced-motion'),'Quiz reduced-motion support missing');
assert(netlify.includes('from = "/find-your-realm"') && netlify.includes('to = "/find-your-realm.html"'),'Quiz route missing');
assert(home.includes('href="/find-your-realm"'),'Homepage quiz entry point missing');
console.log('Validated optional weighted Find Your Realm quiz, shareable results, realm coverage, accessibility messaging, responsive styling and public routing.');
