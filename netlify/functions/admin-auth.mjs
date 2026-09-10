import { env } from './_env.mjs';
import { createAdminSession, adminSessionCookie, clearAdminSessionCookie, isAdmin } from './_admin-auth.mjs';
import { clean, json, readBody } from './_response.mjs';
import { timingSafeEqual } from 'node:crypto';
function equal(a='',b=''){const x=Buffer.from(String(a));const y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
export default async (req)=>{if(req.method==='GET')return json({authenticated:isAdmin(req)});if(req.method==='DELETE')return json({authenticated:false},200,{'Set-Cookie':clearAdminSessionCookie()});if(req.method!=='POST')return json({error:'Method not allowed.'},405);const expected=env('WILDONES_ADMIN_KEY');if(!expected||!env('WILDONES_ADMIN_SESSION_SECRET'))return json({error:'Admin authentication is not configured.'},503);let body;try{body=await readBody(req);}catch{return json({error:'Invalid request.'},400);}const supplied=clean(body.key,1024);if(!supplied||!equal(supplied,expected))return json({error:'Invalid admin key.'},401);return json({authenticated:true},200,{'Set-Cookie':adminSessionCookie(createAdminSession())});};
export const config={path:'/api/admin/auth'};
