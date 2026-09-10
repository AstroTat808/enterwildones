import { env } from './_env.mjs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'wildones_admin';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
function b64url(input) { return Buffer.from(input).toString('base64url'); }
function equal(left = '', right = '') { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && timingSafeEqual(a,b); }
function sessionSecret() { return env('WILDONES_ADMIN_SESSION_SECRET'); }
function sign(payload) { return createHmac('sha256', sessionSecret()).update(payload).digest('base64url'); }
function parseCookies(req) { return Object.fromEntries((req.headers.get('cookie') || '').split(';').map((part)=>{ const i=part.indexOf('='); return i<0?['','']:[part.slice(0,i).trim(),decodeURIComponent(part.slice(i+1).trim())]; }).filter(([key])=>key)); }
export function createAdminSession() { if(!sessionSecret()) throw new Error('Admin session secret is not configured.'); const payload=b64url(JSON.stringify({role:'admin',exp:Math.floor(Date.now()/1000)+SESSION_TTL_SECONDS,nonce:randomBytes(12).toString('hex')})); return `${payload}.${sign(payload)}`; }
export function adminSessionCookie(token){return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;}
export function clearAdminSessionCookie(){return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;}
export function verifyAdminSession(token=''){if(!sessionSecret()||!token.includes('.'))return false;const [payload,supplied]=token.split('.',2);if(!equal(supplied,sign(payload)))return false;try{const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));return data.role==='admin'&&Number(data.exp)>Math.floor(Date.now()/1000);}catch{return false;}}
export function isAdmin(req){const adminKey=env('WILDONES_ADMIN_KEY');const auth=req.headers.get('authorization')||'';const supplied=auth.startsWith('Bearer ')?auth.slice(7):'';if(adminKey&&supplied&&equal(supplied,adminKey))return true;return verifyAdminSession(parseCookies(req)[COOKIE_NAME]||'');}
