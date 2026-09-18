(() => {
  'use strict';
  const q=s=>document.querySelector(s),login=q('#login'),account=q('#account'),status=q('#status');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const realmClass=realm=>['light','balance','fire','night'].includes(realm)?'realm-'+realm:'realm-cycle';
  let widget=null,securityPromise=null,records=[];
  const api=()=>window.turnstile&&typeof window.turnstile.render==='function'?window.turnstile:null;

  async function security(){
    if(securityPromise)return securityPromise;
    securityPromise=(async()=>{
      const r=await fetch('/api/passport/config'),d=await r.json();
      if(!r.ok||!d.turnstileSiteKey)throw new Error('Passport sign-in is not configured yet.');
      if(!api())await new Promise((resolve,reject)=>{
        const s=document.createElement('script');
        s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.defer=true;
        s.onload=()=>api()?resolve():reject(new Error('Security verification could not initialize.'));
        s.onerror=()=>reject(new Error('Security verification could not load. Please refresh.'));
        document.head.append(s);
      });
      widget=api().render('#passport-turnstile-widget',{sitekey:d.turnstileSiteKey,action:'passport_login',theme:'dark'});
    })();
    return securityPromise;
  }

  async function openPurchase(eventSlug,button){
    button.disabled=true;button.textContent='Opening secure ticket access…';
    try{
      const r=await fetch('/api/passport/ticket-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:eventSlug})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d.nextUrl)throw new Error(d.error||'Ticket access could not be opened.');
      location.assign(d.nextUrl);
    }catch(err){
      button.disabled=false;button.textContent='Purchase Ticket';
      q('#progress').textContent=err.message||'Ticket access could not be opened.';
    }
  }

  function stateInfo(x){
    if(x.checkedIn)return {label:'REALM COMPLETED',kind:'complete'};
    if(x.ticket&&['paid','checked_in'].includes(x.ticket.status))return {label:String(x.ticket.status).replaceAll('_',' ').toUpperCase(),kind:'active'};
    if(x.ticket)return {label:String(x.ticket.status||'TICKET ISSUED').replaceAll('_',' ').toUpperCase(),kind:'pending'};
    if(x.application)return {label:String(x.application.status||'APPLICATION').replaceAll('_',' ').toUpperCase(),kind:'pending'};
    if(x.invitation&&x.invitation.status==='redeemed')return {label:'INVITATION REDEEMED',kind:'active'};
    return {label:'NOT ENTERED',kind:'locked'};
  }

  function cycleNode(x){
    const e=x.event,meta=window.WildOnesBrand?.meta(e.realm),state=stateInfo(x);
    return '<div class="passport-cycle-node" data-brand-realm="'+esc(e.realm)+'" data-state="'+esc(state.kind)+'"><i>'+esc(meta?.roman||'•')+'</i><span>'+esc(e.name)+'</span></div>';
  }

  function render(selected='cycle'){
    window.WildOnesBrand?.set({realm:selected});
    q('#realmFilter').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.realm===selected)));
    const visible=records.filter(x=>selected==='cycle'||x.event.realm===selected);
    if(!visible.length){q('#realms').innerHTML='<div class="passport-empty">No realm records are available for this view yet.</div>';return;}
    q('#realms').innerHTML=visible.map(x=>{
      const e=x.event,state=stateInfo(x);
      const active=x.ticket&&['paid','checked_in'].includes(x.ticket.status);
      const link=active&&typeof x.ticket.ticketUrl==='string'&&x.ticket.ticketUrl.startsWith('/ticket?token=')?x.ticket.ticketUrl:e.routes.event;
      const cls=realmClass(e.realm),meta=window.WildOnesBrand?.meta(e.realm);
      const ticketMeta=x.ticket?'<div class="passport-ticket-meta"><div><span>ADMISSION</span><strong>'+esc(x.ticket.ticketId)+'</strong></div><div><span>WAIVER</span><strong>'+(x.waiverSigned?'Recorded':'Required before entry')+'</strong></div></div>':'';
      const invitationMeta=x.invitation&&x.invitation.status==='redeemed'&&!x.ticket?'<div class="passport-access-note"><span>ACCESS</span><strong>Invitation redeemed'+(x.commissioningAccess?' · Commissioning access':'')+'</strong></div>':'';
      const activeEntitlements=(Array.isArray(x.entitlements)?x.entitlements:[]).filter(a=>a.status==='active');
      const entitlementBlock=activeEntitlements.length?'<div class="passport-entitlements"><span>ADD-ONS</span><div class="passport-entitlement-list">'+activeEntitlements.map(a=>'<em>'+esc(String(a.addonType).replaceAll('_',' '))+'</em>').join('')+'</div></div>':'';
      const action=x.purchaseAvailable?'<button class="button" type="button" data-purchase-event="'+esc(e.slug)+'">Purchase Ticket</button>':'<a class="button ghost" href="'+esc(link)+'">'+(active&&link.startsWith('/ticket?')?'Open Digital Ticket':'Explore the Realm')+'</a>';
      return '<article class="passport-card" data-brand-realm="'+esc(e.realm)+'" data-passport-state="'+esc(state.kind)+'"><div class="passport-card-topline"><span class="passport-roman">'+esc(meta?.roman||'•')+'</span><span class="passport-credential-label">DIGITAL REALM CREDENTIAL</span><span class="realm-chip '+cls+'">'+esc(meta?.sub||e.realm)+'</span></div><img class="passport-card-logo" src="'+esc(window.WildOnesBrand.asset(e.realm))+'" alt="'+esc(window.WildOnesBrand.label(e.realm))+'" width="768" height="768" loading="lazy"><h2 class="realm-key '+cls+'">'+esc(e.name)+'</h2><strong class="passport-state">'+esc(state.label)+'</strong><p class="passport-card-tagline">'+esc(e.copy.tagline)+'</p>'+ticketMeta+invitationMeta+entitlementBlock+'<div class="passport-card-actions">'+action+'</div></article>';
    }).join('');
    q('#realms').querySelectorAll('[data-purchase-event]').forEach(button=>button.addEventListener('click',()=>openPurchase(button.dataset.purchaseEvent,button)));
  }

  function updateCycle(cycle){
    const total=Math.max(Number(cycle?.total)||records.length||4,1);
    const completed=Math.min(Math.max(Number(cycle?.completed)||0,0),total);
    const pct=Math.max(0,Math.min(100,(completed/total)*100));
    q('#cycleFraction').textContent=completed+' / '+total;
    q('#cycleFill').style.width=pct+'%';
    q('#cycleTrack').setAttribute('aria-valuemax',String(total));
    q('#cycleTrack').setAttribute('aria-valuenow',String(completed));
    q('#cycleNodes').innerHTML=records.map(cycleNode).join('');
  }

  async function load(){
    try{
      const r=await fetch('/api/passport',{cache:'no-store'}),d=await r.json();
      if(r.status===401||d.authenticated===false){login.hidden=false;account.hidden=true;await security();return;}
      if(!r.ok)throw new Error('Your Passport is temporarily unavailable. Please refresh.');
      records=Array.isArray(d.realms)?d.realms:[];
      login.hidden=true;account.hidden=false;
      const preferred=d.user.preferredName||d.user.fullName||'Wild One';
      q('#welcome').textContent='Welcome, '+preferred+'.';
      q('#progress').textContent=d.cycle.completed+' of '+d.cycle.total+' realms completed · your cycle updates automatically';
      updateCycle(d.cycle);
      const filters=[{realm:'cycle',name:'All Realms'},...records.map(x=>x.event)];
      q('#realmFilter').replaceChildren(...filters.map(e=>{const b=document.createElement('button');b.type='button';b.dataset.realm=e.realm;b.className='realm-chip '+realmClass(e.realm);b.textContent=e.name;b.onclick=()=>render(e.realm);return b;}));
      render();
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
      if(!r.ok)throw new Error(d.error||'Sign-in request failed.');
      status.textContent=d.message||'Check your inbox for your sign-in link.';
    }catch(e){status.textContent=e.message||'Sign-in request failed.';}
    finally{b.disabled=false;if(api()&&widget!==null)api().reset(widget);}
  });

  q('#logout').addEventListener('click',async e=>{
    e.currentTarget.disabled=true;
    try{const r=await fetch('/api/passport',{method:'DELETE'});if(!r.ok)throw 0;location.reload();}
    catch{e.currentTarget.disabled=false;q('#progress').textContent='Sign-out failed. Please try again.';}
  });
  load();
})();