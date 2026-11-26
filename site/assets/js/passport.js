(() => {
  'use strict';
  const q=s=>document.querySelector(s),login=q('#login'),account=q('#account'),status=q('#status');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const realmClass=realm=>['light','balance','fire','night'].includes(realm)?'realm-'+realm:'realm-cycle';
  let widget=null,securityPromise=null,records=[],activeUserId='',pendingUnlockRealms=[],pendingMasterUnlock=false;
  const refreshInterval=5000,refreshWindow=120000,requestTimeout=15000;
  let selectedRealm='cycle',renderedSnapshot='',filterSnapshot='';
  let refreshTimer=null,refreshDeadline=0,loadPromise=null,loadController=null,loadSequence=0,lastLoadStarted=0;
  let pageActive=true,signingOut=false;
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
      // At narrow widths, the 300px widget would exceed the Passport panel.
      // Cloudflare's compact widget keeps verification fully visible and usable.
      const availableWidth=q('#passport-turnstile-widget').getBoundingClientRect().width;
      widget=api().render('#passport-turnstile-widget',{sitekey:d.turnstileSiteKey,action:'passport_login',theme:'dark',size:Math.min(availableWidth,Math.max(0,document.documentElement.clientWidth-40))<300?'compact':'normal'});
    })();
    return securityPromise;
  }

  async function openPurchase(eventSlug,button){
    const message=button.closest('.passport-card')?.querySelector('.passport-purchase-message');
    const initialLabel=button.textContent;
    button.disabled=true;
    button.textContent='Opening secure ticket access…';
    if(message){
      message.textContent='Verifying your invitation and preparing checkout…';
      message.dataset.state='loading';
    }
    try{
      const r=await fetch('/api/passport/ticket-access',{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({event:eventSlug})
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d.nextUrl)throw new Error(d.error||'Ticket access could not be opened.');
      location.assign(d.nextUrl);
    }catch(err){
      button.disabled=false;
      button.textContent=initialLabel;
      if(message){
        message.textContent=err.message||'Ticket access could not be opened.';
        message.dataset.state='error';
      }else{
        q('#progress').textContent=err.message||'Ticket access could not be opened.';
      }
    }
    // Keep the action disabled after a successful redirect is requested,
    // preventing rapid double clicks while navigation begins.
  }

  function stateInfo(x){
    if(x.checkedIn)return {label:'REALM COMPLETED',kind:'complete'};
    if(x.ticket?.status==='checked_in')return {label:'REALM COMPLETED',kind:'complete'};
    if(x.ticket?.status==='paid')return {label:'TICKET PURCHASED',kind:'active'};
    if(x.ticket)return {label:String(x.ticket.status||'TICKET ISSUED').replaceAll('_',' ').toUpperCase(),kind:'pending'};
    if(x.invitation&&x.invitation.status==='redeemed')return {label:'INVITATION REDEEMED',kind:'active'};
    if(x.application)return {label:String(x.application.status||'APPLICATION').replaceAll('_',' ').toUpperCase(),kind:'pending'};
    return {label:'NOT ENTERED',kind:'locked'};
  }

  function cycleNode(x){
    const e=x.event,meta=window.WildOnesBrand?.meta(e.realm),state=stateInfo(x);
    return '<div class="passport-cycle-node" data-brand-realm="'+esc(e.realm)+'" data-state="'+esc(state.kind)+'"><i>'+esc(meta?.roman||'•')+'</i><span class="tx-meta-label">'+esc(e.name)+'</span></div>';
  }

  function completionStorageKey(userId){return 'wildones:passport:completion:'+String(userId||'guest');}
  function readCompletionSnapshot(userId){
    try{const raw=localStorage.getItem(completionStorageKey(userId));return raw?JSON.parse(raw):null;}catch{return null;}
  }
  function writeCompletionSnapshot(userId,snapshot){
    try{localStorage.setItem(completionStorageKey(userId),JSON.stringify(snapshot));}catch{}
  }
  function currentCompletionSnapshot(){
    return Object.fromEntries(records.map(x=>[x.event.slug,Boolean(x.checkedIn)]));
  }
  function detectCompletionTransitions(userId){
    const previous=readCompletionSnapshot(userId);
    const current=currentCompletionSnapshot();
    const hasPrevious=previous&&typeof previous==='object'&&!Array.isArray(previous);
    pendingUnlockRealms=hasPrevious?records.filter(x=>x.checkedIn&&previous[x.event.slug]===false).map(x=>x.event.slug):[];
    const wasCycleComplete=Boolean(hasPrevious&&records.length&&records.every(x=>previous[x.event.slug]===true));
    const cycleComplete=Boolean(records.length>=4&&records.every(x=>x.checkedIn));
    pendingMasterUnlock=Boolean(hasPrevious&&!wasCycleComplete&&cycleComplete);
    writeCompletionSnapshot(userId,current);
  }

  function masterCycleCard(){
    const completeCount=records.filter(x=>x.checkedIn).length;
    const unlocked=records.length>=4&&records.every(x=>x.checkedIn);
    const status=unlocked?'MASTER CYCLE UNLOCKED':'LOCKED · '+completeCount+' / '+Math.max(records.length,4)+' REALMS COMPLETED';
    const realmMarks=records.map(x=>{
      const meta=window.WildOnesBrand?.meta(x.event.realm);
      return '<span class="tx-meta-label" data-brand-realm="'+esc(x.event.realm)+'" data-complete="'+String(Boolean(x.checkedIn))+'"><i>'+esc(meta?.roman||'•')+'</i>'+esc(x.event.name)+'</span>';
    }).join('');
    return '<article class="passport-card passport-master-card" data-brand-realm="cycle" data-passport-state="'+(unlocked?'complete':'locked')+'" data-master-cycle="'+(unlocked?'unlocked':'locked')+'"><div class="passport-card-topline"><span class="passport-roman">∞</span><span class="passport-credential-label tx-meta-label">MASTER CYCLE CREDENTIAL</span><span class="realm-chip realm-cycle tx-meta-label">REALM V · COMPLETION</span></div><img class="passport-card-logo passport-master-logo" src="'+esc(window.WildOnesBrand.asset('cycle'))+'" alt="Enter Wild Ones - The Four Realms" width="768" height="768" loading="eager" decoding="async"><h2 class="realm-key tx-card-title">MASTER CYCLE</h2><strong class="passport-state tx-meta-label">'+esc(status)+'</strong><p class="passport-card-tagline tx-body">'+(unlocked?'All four realms are complete. The cycle is whole, and this credential records the full journey.':'Complete all four realm credentials to awaken the Master Cycle.')+'</p><div class="passport-master-realms" aria-label="Master Cycle realm completion">'+realmMarks+'</div><div class="passport-master-seal"><strong>∞</strong><span class="tx-body">'+(unlocked?'Credential earned · The cycle remembers.':'Complete every realm to unlock this prestige credential.')+'</span></div></article>';
  }

  function makeCompletionOverlay(kind){
    const overlay=document.createElement('div');
    overlay.className='realm-complete-overlay'+(kind==='master'?' master-cycle-overlay':'');
    const strong=document.createElement('strong');
    const span=document.createElement('span');
    strong.className='tx-card-title';
    span.className='tx-meta-label';
    strong.textContent=kind==='master'?'MASTER CYCLE UNLOCKED':'REALM COMPLETED';
    span.textContent=kind==='master'?'The Four Realms are complete.':'The cycle remembers.';
    overlay.append(strong,span);
    return overlay;
  }

  function playRealmUnlock(card,delay=0){
    if(!card)return;
    setTimeout(()=>{
      if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      card.querySelector('.realm-complete-overlay')?.remove();
      card.append(makeCompletionOverlay('realm'));
      card.classList.remove('realm-unlock');
      void card.offsetWidth;
      card.classList.add('realm-unlock');
      setTimeout(()=>{card.classList.remove('realm-unlock');card.querySelector('.realm-complete-overlay')?.remove();},2200);
    },delay);
  }

  function buildMasterCycleCeremony(){
    q('.master-cycle-ceremony')?.remove();
    const ceremony=document.createElement('div');
    ceremony.className='master-cycle-ceremony';
    ceremony.setAttribute('role','dialog');
    ceremony.setAttribute('aria-modal','true');
    ceremony.setAttribute('aria-labelledby','masterCycleCeremonyTitle');
    ceremony.setAttribute('aria-describedby','masterCycleCeremonyCopy');
    ceremony.innerHTML='<div class="master-cycle-cosmos" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div><div class="master-cycle-stage"><p class="master-cycle-kicker tx-label">THE FOUR REALMS ARE COMPLETE</p><div class="master-cycle-orbit" aria-hidden="true"><div class="master-cycle-ring ring-one"></div><div class="master-cycle-ring ring-two"></div><div class="master-cycle-realm master-cycle-realm--light" data-brand-realm="light"><i>I</i><strong>AUREVA</strong><span>LIGHT</span></div><div class="master-cycle-realm master-cycle-realm--balance" data-brand-realm="balance"><i>II</i><strong>HALORA</strong><span>BALANCE</span></div><div class="master-cycle-realm master-cycle-realm--fire" data-brand-realm="fire"><i>III</i><strong>SUNVEIL</strong><span>FIRE</span></div><div class="master-cycle-realm master-cycle-realm--night" data-brand-realm="night"><i>IV</i><strong>NOCTURNE</strong><span>NIGHT</span></div><div class="master-cycle-core"><img src="'+esc(window.WildOnesBrand.asset('cycle'))+'" alt="" width="768" height="768" decoding="sync"><b>∞</b></div></div><div class="master-cycle-copy"><h2 id="masterCycleCeremonyTitle" class="tx-page-title">MASTER CYCLE UNLOCKED</h2><p id="masterCycleCeremonyCopy" class="tx-body">Light. Balance. Fire. Night. Every realm is now part of your story. The cycle is whole, and your Master Cycle credential has been awakened.</p><span class="master-cycle-motto tx-meta-label">THE CYCLE REMEMBERS.</span><button type="button" class="button master-cycle-continue">Continue to Passport</button></div></div>';
    const close=()=>{
      if(ceremony.classList.contains('is-closing'))return;
      ceremony.classList.add('is-closing');
      document.body.classList.remove('master-cycle-ceremony-open');
      document.removeEventListener('keydown',onKey);
      setTimeout(()=>ceremony.remove(),520);
    };
    const onKey=e=>{if(e.key==='Escape')close();};
    ceremony.querySelector('.master-cycle-continue').addEventListener('click',close);
    document.addEventListener('keydown',onKey);
    document.body.append(ceremony);
    document.body.classList.add('master-cycle-ceremony-open');
    requestAnimationFrame(()=>ceremony.classList.add('is-visible'));
    ceremony.querySelector('.master-cycle-continue').focus({preventScroll:true});
    return ceremony;
  }

  function playMasterUnlock(card,delay=0){
    if(!card)return;
    setTimeout(()=>{
      const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(!reduce){
        card.classList.remove('master-unlock');
        void card.offsetWidth;
        card.classList.add('master-unlock');
        setTimeout(()=>card.classList.remove('master-unlock'),3000);
      }
      buildMasterCycleCeremony();
    },delay);
  }

  function runPendingCeremonies(){
    const realmSlugs=pendingUnlockRealms.splice(0);
    const master=pendingMasterUnlock;
    pendingMasterUnlock=false;
    realmSlugs.forEach((slug,index)=>{
      const card=[...q('#realms').querySelectorAll('[data-event-slug]')].find(node=>node.dataset.eventSlug===slug);
      playRealmUnlock(card,index*420);
    });
    if(master)playMasterUnlock(q('#realms').querySelector('[data-master-cycle="unlocked"]'),realmSlugs.length*420+350);
  }

  // A redeemed invitation always shows its next step; the server controls
  // whether the Purchase Ticket action is enabled.
  function credentialActions(x,link){
    const event=x.event;
    const eventName=esc(event.name);
    const explore='<a class="button ghost passport-explore-cta" href="'+esc(event.routes.event)+'">Explore the Realm</a>';
    const redeemed=x.invitation?.status==='redeemed'&&!x.ticket;
    if(redeemed){
      const allowed=x.purchaseAvailable===true;
      const statusId='passport-purchase-help-'+esc(event.slug);
      const purchase='<button type="button" class="button passport-purchase-cta"'+
        (allowed?' data-purchase-event="'+esc(event.slug)+'"':' disabled aria-disabled="true" aria-describedby="'+statusId+'"')+
        ' aria-label="Purchase '+eventName+' ticket">Purchase Ticket</button>';
      const explanation=allowed
        ? 'Choose your ticket and optional add-ons together in secure checkout.'
        : 'Ticket sales have not opened yet. Your redeemed invitation is saved.';
      return '<div class="passport-card-actions passport-card-actions--purchase">'+purchase+explore+'</div>'+
        '<p class="passport-purchase-message" id="'+statusId+'" role="status" aria-live="polite">'+explanation+'</p>';
    }
    if(x.ticket&&['paid','checked_in'].includes(x.ticket.status)&&
        typeof link==='string'&&link.startsWith('/ticket?token=')){
      return '<div class="passport-card-actions passport-card-actions--ticket">'+
        '<a class="button passport-ticket-cta" href="'+esc(link)+'">Open Digital Ticket</a>'+explore+'</div>';
    }
    return '<div class="passport-card-actions">'+explore+'</div>';
  }

  function render(selected='cycle'){
    selectedRealm=selected;
    window.WildOnesBrand?.set({realm:selected});
    q('#realmFilter').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.realm===selected)));
    const visible=records.filter(x=>selected==='cycle'||x.event.realm===selected);
    if(!visible.length){q('#realms').innerHTML='<div class="passport-empty">No realm records are available for this view yet.</div>';return;}
    const realmCards=visible.map(x=>{
      const e=x.event,state=stateInfo(x);
      const active=x.ticket&&['paid','checked_in'].includes(x.ticket.status);
      const link=active&&typeof x.ticket.ticketUrl==='string'&&x.ticket.ticketUrl.startsWith('/ticket?token=')?x.ticket.ticketUrl:e.routes.event;
      const cls=realmClass(e.realm),meta=window.WildOnesBrand?.meta(e.realm);
      const ticketMeta=x.ticket?'<div class="passport-ticket-meta"><div><span class="tx-meta-label">ADMISSION</span><strong>'+esc(x.ticket.ticketId)+'</strong></div><div><span class="tx-meta-label">WAIVER</span><strong>'+(x.waiverSigned?'Recorded':'Required before entry')+'</strong></div></div>':'';
      const invitationMeta=x.invitation&&x.invitation.status==='redeemed'&&!x.ticket?'<div class="passport-access-note"><span class="tx-meta-label">ACCESS</span><strong>Invitation redeemed'+(x.commissioningAccess?' · Commissioning access':'')+'</strong></div>':'';
      const activeEntitlements=(Array.isArray(x.entitlements)?x.entitlements:[]).filter(a=>a.status==='active');
      const entitlementBlock=activeEntitlements.length?'<div class="passport-entitlements"><span class="tx-meta-label">ADD-ONS</span><div class="passport-entitlement-list">'+activeEntitlements.map(a=>'<em class="tx-meta-label">'+esc(String(a.addonType).replaceAll('_',' '))+'</em>').join('')+'</div></div>':'';
      const actions=credentialActions(x,link);
      return '<article class="passport-card" data-event-slug="'+esc(e.slug)+'" data-brand-realm="'+esc(e.realm)+'" data-passport-state="'+esc(state.kind)+'"><div class="passport-card-topline"><span class="passport-roman">'+esc(meta?.roman||'•')+'</span><span class="passport-credential-label tx-meta-label">DIGITAL REALM CREDENTIAL</span><span class="realm-chip tx-meta-label '+cls+'">'+esc(meta?.sub||e.realm)+'</span></div><img class="passport-card-logo" src="'+esc(window.WildOnesBrand.asset(e.realm))+'" alt="'+esc(window.WildOnesBrand.label(e.realm))+'" width="768" height="768" loading="eager" decoding="async"><h2 class="realm-key tx-card-title '+cls+'">'+esc(e.name)+'</h2><strong class="passport-state tx-meta-label">'+esc(state.label)+'</strong><p class="passport-card-tagline tx-body">'+esc(e.copy.tagline)+'</p>'+ticketMeta+invitationMeta+entitlementBlock+actions+'</article>';
    });
    if(selected==='cycle'){
      const master=masterCycleCard();
      const unlocked=records.length>=4&&records.every(x=>x.checkedIn);
      if(unlocked)realmCards.unshift(master);else realmCards.push(master);
    }
    q('#realms').innerHTML=realmCards.join('');
    q('#realms').querySelectorAll('[data-purchase-event]').forEach(button=>button.addEventListener('click',()=>openPurchase(button.dataset.purchaseEvent,button)));
    if(selected==='cycle')requestAnimationFrame(runPendingCeremonies);
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

  function stopRefresh(abort=false){
    if(refreshTimer!==null)clearTimeout(refreshTimer);
    refreshTimer=null;
    if(abort){
      // Invalidating the request also protects against a late response after
      // sign-out or a page restored from the browser's back/forward cache.
      loadSequence++;
      loadController?.abort();
      loadController=null;
      loadPromise=null;
      lastLoadStarted=0;
    }
  }

  function canRefresh(){
    return pageActive&&!signingOut&&document.visibilityState!=='hidden';
  }

  function awaitingTicket(){
    return records.some(x=>!x.ticket&&(x.invitation?.status==='fulfilled'||
      (x.invitation?.status==='redeemed'&&x.purchaseAvailable===true)));
  }

  function scheduleRefresh(){
    stopRefresh();
    if(!canRefresh()||!activeUserId||!awaitingTicket()||Date.now()>=refreshDeadline)return;
    refreshTimer=setTimeout(()=>{
      refreshTimer=null;
      if(canRefresh()&&Date.now()<refreshDeadline)load();
    },Math.min(refreshInterval,refreshDeadline-Date.now()));
  }

  function resumeRefresh(){
    if(!canRefresh())return;
    refreshDeadline=Date.now()+refreshWindow;
    stopRefresh();
    // Focus, visibilitychange and pageshow can arrive together. Share one
    // request and keep one timer rather than creating parallel polling loops.
    if(loadPromise)return;
    if(Date.now()-lastLoadStarted<1000){scheduleRefresh();return;}
    load();
  }

  function focusedCredentialAction(){
    const focused=document.activeElement;
    const card=focused?.closest?.('[data-event-slug]');
    if(!card||!q('#realms').contains(focused))return null;
    const kind=focused.matches('.passport-purchase-cta')?'purchase':
      focused.matches('.passport-ticket-cta')?'ticket':
      focused.matches('.passport-explore-cta')?'explore':null;
    return kind?{slug:card.dataset.eventSlug,kind}:null;
  }

  function restoreCredentialFocus(focus){
    if(!focus)return;
    const card=[...q('#realms').querySelectorAll('[data-event-slug]')].find(x=>x.dataset.eventSlug===focus.slug);
    const selector=focus.kind==='explore'?'.passport-explore-cta':
      '.passport-purchase-cta:not([disabled]), .passport-ticket-cta, .passport-explore-cta';
    card?.querySelector(selector)?.focus({preventScroll:true});
  }

  function applyPassport(d){
    const userId=String(d.user.userId||d.user.email||'wild-one');
    const newlyPurchased=userId===activeUserId&&d.realms.some(next=>next.ticket?.status==='paid'&&
      records.some(previous=>previous.event.slug===next.event.slug&&!previous.ticket));
    const snapshot=JSON.stringify({user:d.user,cycle:d.cycle,realms:d.realms});
    const progress=d.cycle.completed+' of '+d.cycle.total+' realms completed · your cycle updates automatically';
    q('#progress').setAttribute('aria-live','polite');
    q('#progress').textContent=(newlyPurchased?'Ticket purchased. Your digital ticket is ready. ':'')+progress;
    // An unchanged response must not replace controls or disturb keyboard focus.
    if(snapshot===renderedSnapshot)return;
    const focused=focusedCredentialAction();
    if(activeUserId&&userId!==activeUserId)selectedRealm='cycle';
    activeUserId=userId;
    records=d.realms;
    renderedSnapshot=snapshot;
    detectCompletionTransitions(activeUserId);
    login.hidden=true;account.hidden=false;
    q('#welcome').textContent='Welcome, '+(d.user.preferredName||d.user.fullName||'Wild One')+'.';
    updateCycle(d.cycle);
    const filters=[{realm:'cycle',name:'All Realms'},...records.map(x=>x.event)];
    const nextFilters=JSON.stringify(filters.map(e=>[e.realm,e.name]));
    if(nextFilters!==filterSnapshot){
      filterSnapshot=nextFilters;
      q('#realmFilter').replaceChildren(...filters.map(e=>{const b=document.createElement('button');b.type='button';b.dataset.realm=e.realm;b.className='realm-chip tx-meta-label '+realmClass(e.realm);b.textContent=e.name;b.onclick=()=>render(e.realm);return b;}));
    }
    if(selectedRealm!=='cycle'&&!records.some(x=>x.event.realm===selectedRealm))selectedRealm='cycle';
    render(selectedRealm);
    restoreCredentialFocus(focused);
  }

  function clearAccount(){
    records=[];activeUserId='';renderedSnapshot='';filterSnapshot='';selectedRealm='cycle';
    pendingUnlockRealms=[];pendingMasterUnlock=false;refreshDeadline=0;
    q('#realms').replaceChildren();q('#realmFilter').replaceChildren();
    account.hidden=true;login.hidden=false;
  }

  function load(){
    if(loadPromise)return loadPromise;
    if(!canRefresh())return Promise.resolve();
    stopRefresh();
    lastLoadStarted=Date.now();
    const sequence=++loadSequence;
    const controller=new AbortController();
    loadController=controller;
    const timeout=setTimeout(()=>controller.abort(),requestTimeout);
    const pending=(async()=>{
      try{
        const r=await fetch('/api/passport',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        if(sequence!==loadSequence||signingOut)return;
        // Authentication expiry must clear the credential even if an upstream
        // response has an empty or non-JSON body.
        if(r.status===401){clearAccount();await security();return;}
        const d=await r.json();
        if(sequence!==loadSequence||signingOut)return;
        if(d.authenticated===false){clearAccount();await security();return;}
        if(!r.ok||d.authenticated!==true||!d.user||!d.cycle||!Array.isArray(d.realms))
          throw new Error('Your Passport is temporarily unavailable. Please refresh.');
        applyPassport(d);
      }catch(e){
        if(sequence!==loadSequence||signingOut)return;
        if(activeUserId){
          q('#progress').textContent='Your Passport could not refresh. Your current credential is still shown.';
        }else{
          login.hidden=false;
          status.textContent=e.name==='AbortError'?'Your Passport took too long to load. Please refresh.':
            e.message||'Passport could not load. Please refresh.';
        }
      }finally{
        clearTimeout(timeout);
        if(loadPromise===pending){loadPromise=null;loadController=null;scheduleRefresh();}
      }
    })();
    loadPromise=pending;
    return pending;
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
      // A successful request always leads to the same confirmation page, without
      // disclosing whether the supplied email belongs to an active Passport.
      window.location.assign('/passport/check-email');
    }catch(e){status.textContent=e.message||'Sign-in request failed.';}
    finally{b.disabled=false;if(api()&&widget!==null)api().reset(widget);}
  });

  q('#logout').addEventListener('click',async e=>{
    e.currentTarget.disabled=true;
    signingOut=true;stopRefresh(true);
    try{const r=await fetch('/api/passport',{method:'DELETE'});if(!r.ok)throw 0;clearAccount();location.reload();}
    catch{signingOut=false;e.currentTarget.disabled=false;q('#progress').textContent='Sign-out failed. Please try again.';scheduleRefresh();}
  });
  window.addEventListener('focus',resumeRefresh);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden')stopRefresh(true);else resumeRefresh();
  });
  window.addEventListener('pagehide',()=>{pageActive=false;stopRefresh(true);});
  window.addEventListener('pageshow',e=>{
    pageActive=true;
    if(e.persisted){
      // Browser back can restore the disabled "Opening secure ticket access"
      // control. Rebuild it from fresh server data even when that data is unchanged.
      renderedSnapshot='';
      resumeRefresh();
    }
  });
  refreshDeadline=Date.now()+refreshWindow;
  load();
})();
