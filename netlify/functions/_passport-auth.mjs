import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { neon, Pool } from '@neondatabase/serverless';
import { blobStore } from './_blob-store.mjs';
import { env } from './_env.mjs';
import { parseCookies } from './_security.mjs';
import { STORES,emailIndexKey,userKey } from './_stores.mjs';

function databaseUrl(){const url=env('DATABASE_URL');if(!url)throw new Error('DATABASE_URL is not configured.');return url;}
function getSql(){return neon(databaseUrl());}

const COOKIE='wildones_passport';
const SESSION_TTL=30*24*60*60;
const MAGIC_TTL=15*60;
function secret(){return env('WILDONES_PASSPORT_SESSION_SECRET');}
function safeEqual(a='',b=''){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
function sign(payload){return createHmac('sha256',secret()).update(payload).digest('base64url');}
function encode(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
function decode(value){return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}
export async function findUserByEmail(email=''){const indexes=blobStore(STORES.userIndexes),ref=await indexes.get(emailIndexKey(email),{type:'json'}).catch(()=>null);if(!ref?.userId)return null;return blobStore(STORES.users).get(userKey(ref.userId),{type:'json'}).catch(()=>null);}
export async function createMagicLink(user){if(!secret())throw new Error('Passport session secret is not configured.');const tokenId=randomBytes(24).toString('base64url'),expiresAt=new Date(Date.now()+MAGIC_TTL*1000);const sql=getSql();await sql`INSERT INTO wildones_passport_magic_links(token_id,user_id,email,expires_at) VALUES(${tokenId},${user.userId},${user.email},${expiresAt.toISOString()})`;const payload=encode({v:1,typ:'wildones-passport-magic',tokenId,userId:user.userId,email:user.email,exp:Math.floor(expiresAt.getTime()/1000)});return `${payload}.${sign(payload)}`;}
export async function consumeMagicLink(token=''){if(!secret()||!String(token).includes('.'))return null;const[p,s]=String(token).split('.',2);if(!safeEqual(s,sign(p)))return null;let data;try{data=decode(p);}catch{return null;}if(data.v!==1||data.typ!=='wildones-passport-magic'||Number(data.exp)<=Math.floor(Date.now()/1000))return null;const pool=new Pool({connectionString:databaseUrl(),connectionTimeoutMillis:10000});// Keep the connection inside this request for the interactive transaction.
let client;try{client=await pool.connect();await client.query('BEGIN');const result=await client.query('SELECT token_id,user_id,email,expires_at,consumed_at FROM wildones_passport_magic_links WHERE token_id=$1 FOR UPDATE',[data.tokenId]);const row=result.rows[0];if(!row||row.consumed_at||new Date(row.expires_at).getTime()<=Date.now()||row.user_id!==data.userId||row.email!==data.email){await client.query('ROLLBACK');return null;}await client.query('UPDATE wildones_passport_magic_links SET consumed_at=NOW() WHERE token_id=$1',[data.tokenId]);await client.query('COMMIT');return data;}catch(error){await client?.query('ROLLBACK').catch(()=>{});throw error;}finally{client?.release();await pool.end();}}
export function createPassportSession(user){if(!secret())throw new Error('Passport session secret is not configured.');const now=Math.floor(Date.now()/1000),payload=encode({v:1,typ:'wildones-passport-session',userId:user.userId,email:user.email,iat:now,exp:now+SESSION_TTL});return `${payload}.${sign(payload)}`;}
export function passportCookie(token){return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Lax`;}
export function clearPassportCookie(){return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;}
export function readPassportSession(req){const token=parseCookies(req)[COOKIE]||'';if(!secret()||!token.includes('.'))return null;const[p,s]=token.split('.',2);if(!safeEqual(s,sign(p)))return null;try{const d=decode(p);if(d.v!==1||d.typ!=='wildones-passport-session'||Number(d.exp)<=Math.floor(Date.now()/1000))return null;return d;}catch{return null;}}
