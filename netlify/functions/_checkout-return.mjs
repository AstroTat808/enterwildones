import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './_env.mjs';
import { requireEvent } from './_events.mjs';
function secret(){return env('WILDONES_TICKET_ACCESS_SECRET');}
function equal(a='',b=''){const x=Buffer.from(String(a));const y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
function sign(p){return createHmac('sha256',secret()).update(p).digest('base64url');}
export function makeCheckoutReturn({eventId,invitationId}){if(!secret())return null;requireEvent(eventId);const payload=Buffer.from(JSON.stringify({v:1,typ:'wildones-checkout-return',eventId,invitationId,exp:Math.floor(Date.now()/1000)+7200})).toString('base64url');return `${payload}.${sign(payload)}`;}
export function verifyCheckoutReturn(token=''){if(!secret()||!String(token).includes('.'))return null;const[p,s]=String(token).split('.',2);if(!equal(s,sign(p)))return null;try{const d=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));if(d.v!==1||d.typ!=='wildones-checkout-return'||Number(d.exp)<=Math.floor(Date.now()/1000))return null;requireEvent(d.eventId);return d;}catch{return null;}}
