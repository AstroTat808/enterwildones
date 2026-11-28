import { createPrivateKey, sign, createHash } from 'node:crypto';
import { env } from './_env.mjs';

const TOKEN_URL='https://oauth2.googleapis.com/token';
const API='https://walletobjects.googleapis.com/walletobjects/v1/eventTicketObject';
const scope='https://www.googleapis.com/auth/wallet_object.issuer';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
export function googleWalletConfig(eventId) {
  if(env('WILDONES_GOOGLE_WALLET_ENABLED')!=='true') return null;
  const issuer=env('WILDONES_GOOGLE_WALLET_ISSUER_ID');
  const email=env('WILDONES_GOOGLE_WALLET_SERVICE_EMAIL');
  const pem=env('WILDONES_GOOGLE_WALLET_PRIVATE_KEY').replaceAll('\\n','\n');
  if(!/^\d+$/.test(issuer)||!email.endsWith('.gserviceaccount.com')||!pem) return null;
  let classes,key;
  try{
    classes=JSON.parse(env('WILDONES_GOOGLE_WALLET_CLASSES','{}'));
    key=createPrivateKey(pem);
    if(key.asymmetricKeyType!=='rsa') return null;
  }catch{return null;}
  const classId=classes?.[eventId];
  if(typeof classId!=='string'||!classId.startsWith(issuer+'.')||!/^[A-Za-z0-9_.-]+$/.test(classId))return null;
  return {issuer,email,key,classId};
}
export function signGoogleJwt(config,claims){
  const body=encode({alg:'RS256',typ:'JWT'})+'.'+encode(claims);
  return body+'.'+sign('RSA-SHA256',Buffer.from(body),config.key).toString('base64url');
}
async function accessToken(config,fetcher){
  const iat=Math.floor(Date.now()/1000);
  const assertion=signGoogleJwt(config,{iss:config.email,scope,aud:TOKEN_URL,iat,exp:iat+3600});
  const response=await fetcher(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('Google Wallet authorization unavailable');
  const data=await response.json();
  if(typeof data.access_token!=='string'||!data.access_token)throw new Error('Google Wallet authorization unavailable');
  return data.access_token;
}
export function buildGoogleObject(config,{event,ticket,scanToken,expiresAt}){
  const suffix=createHash('sha256').update(event.eventId+'|'+ticket.ticketId).digest('hex').slice(0,40);
  return {id:config.issuer+'.'+suffix,classId:config.classId,state:'ACTIVE',
    ticketNumber:ticket.ticketId,hexBackgroundColor:event.theme.background,
    barcode:{type:'QR_CODE',value:scanToken,alternateText:ticket.ticketId},
    validTimeInterval:{end:{date:expiresAt}},
    textModulesData:[{id:'entry',header:'Admission',body:'Present this QR with matching photo ID. Final admission and drink-credit balances are verified by Wild Ones staff. Open your Passport for current status.'}]
  };
}
export async function issueGoogleWallet(config,credential,{fetcher=fetch,origin='https://enterwildones.com'}={}){
  const object=buildGoogleObject(config,credential);
  const token=await accessToken(config,fetcher);
  const headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'};
  const send=(url,method,body)=>fetcher(url,{method,headers,body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
  let result=await send(API,'POST',object);
  if(result.status===409)result=await send(API+'/'+encodeURIComponent(object.id),'PATCH',object);
  if(!result.ok)throw new Error('Google Wallet pass unavailable');
  // The save link contains an object reference only, not a guest-access token.
  const jwt=signGoogleJwt(config,{iss:config.email,aud:'google',typ:'savetowallet',iat:Math.floor(Date.now()/1000),origins:[new URL(origin).origin],payload:{eventTicketObjects:[{id:object.id}]}});
  return 'https://pay.google.com/gp/v/save/'+jwt;
}
