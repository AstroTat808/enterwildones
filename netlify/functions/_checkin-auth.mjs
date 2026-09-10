import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './_env.mjs';
import { parseCookies } from './_security.mjs';
import { requireEvent } from './_events.mjs';
const COOKIE='wildones_checkin',TTL=12*60*60;
function key(){return env('WILDONES_CHECKIN_KEY');}function secret(){return env('WILDONES_CHECKIN_SESSION_SECRET');}function equal(a='',b=''){const x=Buffer.from(String(a));const y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}function sign(p){return createHmac('sha256',secret()).update(p).digest('base64url');}
export function checkinKeyMatches(value){return Boolean(key()&&equal(value,key()));}
export function createCheckinSession(eventId){requireEvent(eventId);if(!secret())throw new Error('Check-in session secret is not configured.');const now=Math.floor(Date.now()/1000);const p=Buffer.from(JSON.stringify({role:'checkin',eventId,iat:now,exp:now+TTL,nonce:randomBytes(10).toString('hex')})).toString('base64url');return`${p}.${sign(p)}`;}
export function checkinCookie(token){return`${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${TTL}; HttpOnly; Secure; SameSite=Strict`;}
export function clearCheckinCookie(){return`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;}
export function readCheckinSession(req){const token=parseCookies(req)[COOKIE]||'';if(!secret()||!token.includes('.'))return null;const[p,s]=token.split('.',2);if(!equal(s,sign(p)))return null;try{const d=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));if(d.role!=='checkin'||Number(d.exp)<=Math.floor(Date.now()/1000))return null;requireEvent(d.eventId);return d;}catch{return null;}}
