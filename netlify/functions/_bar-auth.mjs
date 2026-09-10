import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './_env.mjs';
import { parseCookies } from './_security.mjs';
import { requireEvent } from './_events.mjs';
const COOKIE='wildones_bar',TTL=12*60*60;
function key(){return env('WILDONES_BAR_KEY');}function secret(){return env('WILDONES_BAR_SESSION_SECRET');}function equal(a='',b=''){const x=Buffer.from(String(a));const y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}function sign(p){return createHmac('sha256',secret()).update(p).digest('base64url');}
export function barKeyMatches(value){return Boolean(key()&&equal(value,key()));}
export function createBarSession(eventId){requireEvent(eventId);if(!secret())throw new Error('Bar session secret is not configured.');const now=Math.floor(Date.now()/1000);const p=Buffer.from(JSON.stringify({role:'bar',eventId,iat:now,exp:now+TTL,nonce:randomBytes(10).toString('hex')})).toString('base64url');return`${p}.${sign(p)}`;}
export function barCookie(token){return`${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${TTL}; HttpOnly; Secure; SameSite=Strict`;}
export function clearBarCookie(){return`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;}
export function readBarSession(req){const token=parseCookies(req)[COOKIE]||'';if(!secret()||!token.includes('.'))return null;const[p,s]=token.split('.',2);if(!equal(s,sign(p)))return null;try{const d=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));if(d.role!=='bar'||Number(d.exp)<=Math.floor(Date.now()/1000))return null;requireEvent(d.eventId);return d;}catch{return null;}}
