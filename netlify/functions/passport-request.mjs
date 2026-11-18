import { blobStore } from './_blob-store.mjs';
import { env } from './_env.mjs';
import { renderPassportSignInEmail } from './_mail-templates.mjs';
import { createMagicLink,findUserByEmail } from './_passport-auth.mjs';
import { clientIp,json,readBody } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { normalizedEmail,sha256,STORES } from './_stores.mjs';
import { verifyTurnstile } from './_turnstile.mjs';

async function rate(req,email){const store=blobStore(STORES.rateLimits),key=`passport-login/${sha256(`${clientIp(req)}|${email}`)}`,now=Date.now(),old=await store.get(key,{type:'json'}).catch(()=>null),state=old&&Number(old.windowStart)>now-3600000?old:{windowStart:now,count:0};if(Number(state.count)>=5)return false;await store.setJSON(key,{windowStart:state.windowStart,count:Number(state.count)+1,updatedAt:now});return true;}
async function send(email,token){
  const site=(env('WILDONES_SITE_URL')||'https://enterwildones.com').replace(/\/$/,'');
  const link=`${site}/passport/verify?token=${encodeURIComponent(token)}`;
  if(!env('RESEND_API_KEY')||!env('WILDONES_EMAIL_FROM'))throw new Error('Passport email is not configured.');
  const mail=renderPassportSignInEmail({
    link,
    support:env('WILDONES_HELP_EMAIL','help@enterwildones.com')
  });
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{
      Authorization:`Bearer ${env('RESEND_API_KEY')}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      from:env('WILDONES_EMAIL_FROM'),
      to:[email],
      subject:mail.subject,
      html:mail.html,
      text:mail.text
    })
  });
  if(!response.ok)throw new Error('Passport email could not be sent.');
}
export default async(req)=>{if(req.method!=='POST')return json({error:'Method not allowed.'},405);if(!sameOrigin(req))return json({error:'Origin not allowed.'},403);let body;try{body=await readBody(req);}catch{return json({error:'Invalid request.'},400);}const email=normalizedEmail(body.email);if(!email)return json({error:'Email is required.'},400);const turnstile=await verifyTurnstile(req,body.turnstileToken||body['cf-turnstile-response'],'passport_login');if(!turnstile.ok)return json({error:turnstile.error},403);try{if(!await rate(req,email))return json({ok:true,message:'If a Wild Ones Passport exists for that email, a sign-in link will be sent.'});const user=await findUserByEmail(email);if(user?.status==='active'){const token=await createMagicLink(user);await send(user.email,token);}return json({ok:true,message:'If a Wild Ones Passport exists for that email, a sign-in link will be sent.'});}catch(error){console.error('Passport login request failed',error);return json({error:'Passport sign-in is temporarily unavailable.'},503);}};
export const config={path:'/api/passport/request'};
