// Synthetic isolated test of dual archive requests, pinned version restore, failures.
// Never sends a network request or touches an AWS account.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
const mock='export const getStore=name=>globalThis.__wormTestStore(name); export const getDeployStore=getStore;';
registerHooks({resolve(specifier,context,next){if(specifier==='@netlify/blobs')return{url:'data:text/javascript,'+encodeURIComponent(mock),shortCircuit:true};return next(specifier,context);}});
const maps=new Map();
globalThis.__wormTestStore=name=>{
  if(!maps.has(name))maps.set(name,new Map());
  const map=maps.get(name);
  return {async get(key){return map.has(key)?structuredClone(map.get(key)):null;},async setJSON(key,value,opts={}){if(opts.onlyIfNew&&map.has(key))return{modified:false};map.set(key,structuredClone(value));return{modified:true};},async list({prefix=''}={}){return{blobs:[...map.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}};
};
globalThis.Netlify={context:{deploy:{context:'deploy-preview'}}};
Object.assign(process.env,{WILDONES_WORM_REQUIRED:'true',WILDONES_WORM_RETENTION_DAYS:'2',
WILDONES_WORM_PRIMARY_BUCKET:'mock-primary-archive',WILDONES_WORM_PRIMARY_REGION:'us-west-2',WILDONES_WORM_PRIMARY_ACCOUNT_ID:'111111111111',WILDONES_WORM_PRIMARY_ACCESS_KEY_ID:'SYNTHETIC_PRIMARY',WILDONES_WORM_PRIMARY_SECRET_ACCESS_KEY:'synthetic-only',
WILDONES_WORM_BACKUP_BUCKET:'mock-backup-archive',WILDONES_WORM_BACKUP_REGION:'us-west-1',WILDONES_WORM_BACKUP_ACCOUNT_ID:'222222222222',WILDONES_WORM_BACKUP_ACCESS_KEY_ID:'SYNTHETIC_BACKUP',WILDONES_WORM_BACKUP_SECRET_ACCESS_KEY:'synthetic-only'});
const objects=new Map();let version=0,failBackup=false,corrupt=false;const requests=[];
globalThis.fetch=async(input,opts={})=>{
  const url=new URL(input),h=new Headers(opts.headers),key=url.origin+url.pathname,method=opts.method;
  assert.match(url.hostname,/^mock-(primary|backup)-archive\.s3\.us-west-[12]\.amazonaws\.com$/);
  assert.match(h.get('authorization'),/^AWS4-HMAC-SHA256 Credential=SYNTHETIC_/);
  assert.equal(h.get('x-amz-expected-bucket-owner'),url.hostname.includes('primary')?'111111111111':'222222222222');
  requests.push({method,key});
  if(failBackup&&url.hostname.includes('backup'))return new Response(null,{status:503});
  if(method==='PUT'){
    assert.equal(h.get('x-amz-object-lock-mode'),'COMPLIANCE');assert.equal(h.get('if-none-match'),'*');assert.equal(h.get('x-amz-server-side-encryption'),'AES256');
    assert.equal(h.get('content-md5'),createHash('md5').update(opts.body).digest('base64'));
    assert.equal(h.get('x-amz-content-sha256'),createHash('sha256').update(opts.body).digest('hex'));
    if(objects.has(key))return new Response(null,{status:412});
    const entry={version:'synthetic-version-'+(++version),body:opts.body,until:h.get('x-amz-object-lock-retain-until-date')};objects.set(key,entry);
    return new Response(null,{status:200,headers:{'x-amz-version-id':entry.version}});
  }
  const item=objects.get(key);if(!item)return new Response(null,{status:404});
  if(method==='HEAD')return new Response(null,{headers:{'x-amz-version-id':item.version}});
  assert.equal(method,'GET');assert.equal(url.searchParams.get('versionId'),item.version);
  return new Response(corrupt?'corrupt':item.body,{headers:{'x-amz-version-id':item.version,'x-amz-object-lock-mode':'COMPLIANCE','x-amz-object-lock-retain-until-date':item.until,'x-amz-server-side-encryption':'AES256','x-amz-object-lock-legal-hold':'OFF'}});
};
const {archiveLocked,restoreLocked,lockedReceipt,archiveHealth,runArchiveDrill,wormConfigured}=await import('../netlify/functions/_worm-archive.mjs');
assert.equal(wormConfigured(),true);
const scope='waivers/aureva-2026/WLD-AUR-TKT-1234567890ABCDEF',record={kind:'synthetic',text:'No real personal data'};
const receipt=await archiveLocked(scope,record);
assert.equal(receipt.copies.length,2);assert.equal(await lockedReceipt(scope,receipt.digest),true);
assert.equal((await restoreLocked(scope,receipt.digest)).length,2);
const count=objects.size;assert.deepEqual(await archiveLocked(scope,record),receipt);assert.equal(objects.size,count);
failBackup=true;
const second={kind:'synthetic',text:'Partial dual-write recovery'};
const digest=createHash('sha256').update(JSON.stringify(second)).digest('hex');
await assert.rejects(()=>archiveLocked(scope,second));
assert.equal(await lockedReceipt(scope,digest),false);
failBackup=false;
const recovered=await archiveLocked(scope,second);assert.equal(recovered.digest,digest);
corrupt=true;await assert.rejects(()=>restoreLocked(scope,digest));corrupt=false;
const health=await runArchiveDrill();assert.equal(health.ok,true);assert.equal((await archiveHealth()).healthy,true);
process.env.WILDONES_WORM_RETENTION_DAYS='3';assert.equal((await archiveHealth()).healthy,false,'Policy changes require a new recovery drill');
process.env.WILDONES_WORM_BACKUP_ACCOUNT_ID=process.env.WILDONES_WORM_PRIMARY_ACCOUNT_ID;assert.equal(wormConfigured(),false);
console.log('Synthetic dual-account archive, version pinning, partial failure/retry, tampering and recovery health tests passed.');
