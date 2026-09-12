(() => {
  'use strict';
  const q = s => document.querySelector(s), login=q('#login'), account=q('#account'), status=q('#status');
  const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let widget=null, securityPromise=null, records=[];
  const api=()=>window.turnstile&&typeof window.turnstile.render==='function'?window.turnstile:null;
  async function security(){
    if(securityPromise)return securityPromise;
    securityPromise=(async()=>{
      const r=await fetch('/api/passport/config'),d=await r.json();
      if(!r.ok||!d.turnstileSiteKey)throw new Error('Passport sign-in is not configured yet.');
      if(!api())await new Promise((resolve,reject)=>{
        const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.defer=true;
        s.onload=()=>api()?resolve():reject(new Error('Security verification could not initialize.'));
        s.onerror=()=>reject(new Error('Security verification could not load. Please refresh.'));document.head.append(s);
      });
      widget=api().render('#passport-turnstile-widget',{sitekey:d.turnstileSiteKey,action:'passport_login',theme:'dark'});
    })();return securityPromise;
  }
  function render(selected='cycle'){
    window.WildOnesBrand?.set({realm:selected});
    q('#realmFilter').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.realm===selected)));
    q('#realms').innerHTML=records.filter(x=>selected==='cycle'||x.event.realm===selected).map(x=>{
      const e=x.event,state=x.checkedIn?'REALM COMPLETED':x.ticket?String(x.ticket.status).replaceAll('_',' ').toUpperCase():x.application?String(x.application.status).toUpperCase():'NOT ENTERED';
      const active=x.ticket&&['paid','checked_in'].includes(x.ticket.status);
      const link=active&&typeof x.ticket.ticketUrl==='string'&&x.ticket.ticketUrl.startsWith('/ticket?token=')?x.ticket.ticketUrl:e.routes.event;
      return `<article class="passport-card" data-brand-realm="${esc(e.realm)}"><img src="${esc(window.WildOnesBrand.asset(e.realm))}" alt="${esc(window.WildOnesBrand.label(e.realm))}" width="768" height="768" loading="lazy"><h2>${esc(e.name)}</h2><strong>${esc(state)}</strong><p>${esc(e.copy.tagline)}</p>${x.ticket?`<p>Ticket ${esc(x.ticket.ticketId)}</p><p>${x.waiverSigned?'Waiver recorded':'Waiver required before entry'}</p>`:''}${x.entitlements.filter(a=>a.status==='active').length?`<p>${x.entitlements.filter(a=>a.status==='active').map(a=>esc(String(a.addonType).replaceAll('_',' '))).join(' / ')}</p>`:''}<a class="button ghost" href="${esc(link)}">${active&&link.startsWith('/ticket?')?'Open Digital Ticket':'Explore the Realm'}</a></article>`;
    }).join('');
  }
  async function load(){
    try{
      const r=await fetch('/api/passport'),d=await r.json();
      if(r.status===401||d.authenticated===false){login.hidden=false;account.hidden=true;await security();return;}
      if(!r.ok)throw new Error('Your Passport is temporarily unavailable. Please refresh.');
      records=Array.isArray(d.realms)?d.realms:[];login.hidden=true;account.hidden=false;
      q('#welcome').textContent=`Welcome, ${d.user.preferredName||d.user.fullName||'Wild One'}.`;
      q('#progress').textContent=`${d.cycle.completed} of ${d.cycle.total} realms completed`;
      const filters=[{realm:'cycle',name:'All Realms'},...records.map(x=>x.event)];
      q('#realmFilter').replaceChildren(...filters.map(e=>{const b=document.createElement('button');b.type='button';b.dataset.realm=e.realm;b.textContent=e.name;b.onclick=()=>render(e.realm);return b;}));render();
    }catch(e){login.hidden=false;status.textContent=e.message||'Passport could not load. Please refresh.';}
  }
  q('#passportLoginForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!e.currentTarget.reportValidity())return;
    const b=q('#send');b.disabled=true;
    try{
      await security();const token=widget!==null&&api()?api().getResponse(widget):'';
      if(!token)throw new Error('Complete the security verification before requesting your sign-in link.');
      status.textContent='Sending your secure sign-in link...';
      const r=await fetch('/api/passport/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:q('#email').value.trim(),turnstileToken:token})}),d=await r.json();
      if(!r.ok)throw new Error(d.error||'Sign-in request failed.');status.textContent=d.message||'Check your inbox for your sign-in link.';
    }catch(e){status.textContent=e.message||'Sign-in request failed.';}
    finally{b.disabled=false;if(api()&&widget!==null)api().reset(widget);}
  });
  q('#logout').addEventListener('click',async e=>{
    e.currentTarget.disabled=true;
    try{const r=await fetch('/api/passport',{method:'DELETE'});if(!r.ok)throw 0;location.reload();}
    catch{e.currentTarget.disabled=false;q('#progress').textContent='Sign-out failed. Please try again.';}
  });load();
})();
