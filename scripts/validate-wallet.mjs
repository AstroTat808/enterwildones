import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, verify } from 'node:crypto';
import vm from 'node:vm';
import { makeTicketToken, verifyTicketToken, makeScanToken, verifyScanToken, scanCredentialExpiresAt } from '../netlify/functions/_ticket-token.mjs';
import { googleWalletConfig, buildGoogleObject, issueGoogleWallet } from '../netlify/functions/_google-wallet.mjs';
import { getEvent } from '../netlify/functions/_events.mjs';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const event=getEvent('aureva-2026'),ticket={eventId:event.eventId,ticketId:'WLD-AUR-TKT-1234567890ABCDEF',userId:'wallet-test-user'};
const now=Date.now;Date.now=()=>new Date(event.startsAt).getTime()-86400000;
process.env.WILDONES_TICKET_ACCESS_SECRET='wallet-test-only-not-production';
const token=makeScanToken(ticket),legacy=makeTicketToken(ticket);
assert.ok(token);assert.equal(verifyScanToken(token).typ,'wildones-scan');
assert.equal(verifyScanToken(token).ticketId,ticket.ticketId);
assert.equal(verifyTicketToken(token),null,'Scanner token must never open the private ticket page');
assert.equal(verifyScanToken(legacy).typ,'wildones-ticket');
assert.equal(verifyScanToken(token+'.extra'),null);
assert.equal(verifyScanToken(token.slice(0,-2)+'!!'),null);
assert.equal(verifyScanToken('bad'),null);
Date.now=()=>new Date(scanCredentialExpiresAt(event.eventId)).getTime();
assert.equal(verifyScanToken(token),null);assert.equal(makeScanToken(ticket),null);
Date.now=now;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
process.env.WILDONES_GOOGLE_WALLET_ENABLED='false';
assert.equal(googleWalletConfig(event.eventId),null);
process.env.WILDONES_GOOGLE_WALLET_ENABLED='true';
process.env.WILDONES_GOOGLE_WALLET_ISSUER_ID='123456';
process.env.WILDONES_GOOGLE_WALLET_SERVICE_EMAIL='fixture@example.iam.gserviceaccount.com';
process.env.WILDONES_GOOGLE_WALLET_PRIVATE_KEY=privateKey.export({type:'pkcs8',format:'pem'});
process.env.WILDONES_GOOGLE_WALLET_CLASSES=JSON.stringify({[event.eventId]:'123456.aureva-test'});
const config=googleWalletConfig(event.eventId);assert.ok(config);assert.equal(googleWalletConfig('unknown'),null);
const credential={event,ticket,scanToken:token,expiresAt:scanCredentialExpiresAt(event.eventId)};
const object=buildGoogleObject(config,credential);assert.equal(object.barcode.value,token);assert.equal(object.classId,config.classId);assert.equal(object.id,buildGoogleObject(config,credential).id);assert.ok(!JSON.stringify(object).includes('ticket?token='));
function decodeJwt(jwt){const [header,payload,signature]=jwt.split('.');assert.ok(verify('RSA-SHA256',Buffer.from(header+'.'+payload),publicKey,Buffer.from(signature,'base64url')));return JSON.parse(Buffer.from(payload,'base64url').toString())}
for(const exists of [false,true]){
 const methods=[];
 const fetcher=async(url,opts)=>{methods.push(opts.method);if(url==='https://oauth2.googleapis.com/token'){assert.equal(decodeJwt(opts.body.get('assertion')).aud,url);return Response.json({access_token:'fixture'});}assert.equal(opts.headers.Authorization,'Bearer fixture');assert.equal(JSON.parse(opts.body).barcode.value,token);return new Response(null,{status:exists&&opts.method==='POST'?409:200});};
 const url=await issueGoogleWallet(config,credential,{fetcher});assert.ok(url.startsWith('https://pay.google.com/gp/v/save/'));const claims=decodeJwt(url.split('/').at(-1));assert.equal(claims.typ,'savetowallet');assert.deepEqual(claims.payload.eventTicketObjects,[{id:object.id}]);assert.ok(!JSON.stringify(claims).includes(token));assert.deepEqual(methods,exists?['POST','POST','PATCH']:['POST','POST']);
}
await assert.rejects(issueGoogleWallet(config,credential,{fetcher:async()=>new Response(null,{status:403})}));
const handlers={},cached=[];const fakeCache={addAll:async paths=>cached.push(...paths),match:async()=>null};
vm.runInNewContext(await read('site/wallet/sw.js'),{URL,Response,self:{location:{origin:'https://enterwildones.com'},clients:{claim:async()=>{}},addEventListener:(type,fn)=>handlers[type]=fn},caches:{open:async()=>fakeCache,keys:async()=>[],delete:async()=>true},fetch:async()=>Response.error()});
let install;handlers.install({waitUntil:p=>install=p});await install;
assert.ok(cached.includes('/wallet/'));for(const p of cached){assert.ok(p.startsWith('/wallet/')||p.startsWith('/assets/images/realms/'));assert.ok(!p.includes('?'))}
for(const p of ['/api/passport','/api/wallet/credential','/ticket?token=private','/ticket/qr?token=private','/wallet/?token=private','https://other.example/wallet/']){let intercepted=false;handlers.fetch({request:{url:new URL(p,'https://enterwildones.com').href,method:'GET'},respondWith:()=>intercepted=true});assert.equal(intercepted,false,p)}
let intercepted=false;handlers.fetch({request:{url:'https://enterwildones.com/wallet/',method:'GET'},respondWith:async p=>{intercepted=true;await p}});assert.equal(intercepted,true);
const manifest=JSON.parse(await read('site/wallet/manifest.webmanifest'));assert.equal(manifest.scope,'/wallet/');assert.equal(manifest.display,'standalone');
const endpoint=await read('netlify/functions/wallet-credential.mjs');for(const check of ['sameOrigin(req)','readPassportSession(req)','ticket.userId!==session.userId','waiverIsCurrent(waiver,event.eventId)','makeScanToken(ticket)'])assert.ok(endpoint.includes(check),check);
const checkin=await read('netlify/functions/check-in.mjs');assert.ok(checkin.includes('onlyIfMatch:snapshot.etag'));assert.ok(checkin.includes('verifyScanToken(token)'));
const client=await read('site/wallet/wallet.js');assert.ok(client.includes('localStorage.removeItem(KEY)'));assert.ok(client.includes('swReady'));
console.log('Wallet certification: scoped signatures, expiry, Google RSA and mocked issuance, public-only cache, and policy wiring passed.');
