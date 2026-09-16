const slug=new URLSearchParams(location.search).get('event')||location.pathname.split('/').filter(Boolean).pop();
const fmt=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'Pacific/Honolulu'});
const worlds=Object.freeze({
  light:{index:'REALM I / LIGHT',title:'Begin in radiance.',energyTitle:'Awaken',energyCopy:'Warm, expansive and ceremonial. AUREVA is the first opening of the cycle: a world designed around emergence, connection and the feeling of stepping into first light.',soundTitle:'Ascend',soundCopy:'Melodic electronic music, luminous builds and euphoric release shape an upward arc from arrival through the final hours.',ritualTitle:'Arrive',ritualCopy:'The first realm establishes the Wild Ones language. Cross the threshold, leave the ordinary outside and begin the cycle together.'},
  balance:{index:'REALM II / BALANCE',title:'Stand between worlds.',energyTitle:'Align',energyCopy:'HALORA lives at the equinox: equal parts light and shadow, restraint and release. Its atmosphere is intentional, symmetrical and suspended between opposites.',soundTitle:'Resolve',soundCopy:'Tension and harmony trade places throughout the night. Rhythmic precision, contrast and carefully timed release create the realm’s equilibrium.',ritualTitle:'Center',ritualCopy:'This is the midpoint state: neither beginning nor ending. Enter with the cycle already in motion and find the moment where opposing forces become one.'},
  fire:{index:'REALM III / FIRE',title:'Move with the horizon.',energyTitle:'Ignite',energyCopy:'SUNVEIL is heat, daylight and motion. The realm begins under the sun and intensifies as color drains from the horizon and the night takes over.',soundTitle:'Accelerate',soundCopy:'Bright daytime momentum gives way to heavier nighttime energy. The musical arc follows the sun instead of fighting it.',ritualTitle:'Release',ritualCopy:'SUNVEIL is the least restrained realm: movement first, spectacle second, surrender always. Chase the final light and cross into night at full velocity.'},
  night:{index:'REALM IV / NIGHT',title:'Disappear after dark.',energyTitle:'Descend',energyCopy:'NOCTURNE is private, celestial and scarce. Darkness is not decoration here; it is the architecture of the realm and the final state of the cycle.',soundTitle:'Immerse',soundCopy:'Deep atmosphere, high-impact electronic music and late-night intensity create a world that feels separated from everything beyond its boundary.',ritualTitle:'Return',ritualCopy:'The cycle closes in secrecy. Invitation, arrival and access are part of the experience itself, ending where Wild Ones is most mysterious.'}
});
const text=(selector,value)=>{const node=document.querySelector(selector);if(node)node.textContent=value;};
const money=(cents)=>Number.isInteger(cents)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100):'—';
let countdownTimer=null;
let pricingRefreshTimer=null;

function countdownText(ms){
  if(ms<=0)return 'TRANSITIONING NOW';
  const total=Math.floor(ms/1000),days=Math.floor(total/86400),hours=Math.floor((total%86400)/3600),minutes=Math.floor((total%3600)/60),seconds=total%60;
  return `${days}D ${String(hours).padStart(2,'0')}H ${String(minutes).padStart(2,'0')}M ${String(seconds).padStart(2,'0')}S`;
}

function markRelease(phase,current,next){
  const card=document.querySelector(`[data-release-phase="${phase}"]`),state=document.querySelector(`[data-phase-state="${phase}"]`);
  if(!card)return;
  card.classList.toggle('is-current',current?.phase===phase);
  card.classList.toggle('is-next',next?.phase===phase);
  if(state)state.textContent=current?.phase===phase?'CURRENT RELEASE':next?.phase===phase?'NEXT RELEASE':phase<Number(current?.phase||0)?'RELEASE CLOSED':'UPCOMING RELEASE';
}

async function loadAurevaPricing(){
  const section=document.querySelector('[data-aureva-pricing]');
  if(!section)return;
  let response,data;
  try{
    response=await fetch(`/api/public/pricing?event=${encodeURIComponent(slug||'')}`,{cache:'no-store'});
    data=await response.json();
  }catch{return;}
  if(!response.ok||data.event?.eventId!=='aureva-2026')return;
  section.hidden=false;
  const current=data.current||null,next=data.next||null;
  [1,2,3].forEach((phase)=>markRelease(phase,current,next));
  const phase1=data.phases?.find((phase)=>phase.phase===1),phase2=data.phases?.find((phase)=>phase.phase===2);
  const p1=document.querySelector('[data-release-phase="1"] .release-price'),p2=document.querySelector('[data-release-phase="2"] .release-price');
  if(p1&&phase1?.priceCents)p1.textContent=money(phase1.priceCents);
  if(p2&&phase2?.priceCents)p2.textContent=money(phase2.priceCents);
  const lock=document.querySelector('[data-sales-lock]');
  if(lock)lock.textContent=data.salesOpen?`${current?.name||'Admission'} is now available at ${money(current?.priceCents)}.`:'Ticket sales remain locked while final production systems are certified.';
  const wrap=document.querySelector('[data-release-countdown-wrap]'),counter=document.querySelector('[data-release-countdown]'),label=document.querySelector('[data-release-countdown-label]');
  if(countdownTimer)clearInterval(countdownTimer);
  if(current?.phase===1&&current.endsAt&&counter){
    if(wrap)wrap.hidden=false;
    if(label)label.textContent='FIRST LIGHT FADES IN';
    const target=Date.parse(current.endsAt);
    const tick=()=>{
      const remaining=target-Date.now();
      counter.textContent=countdownText(remaining);
      if(remaining<=0){clearInterval(countdownTimer);countdownTimer=null;setTimeout(loadAurevaPricing,800);}
    };
    tick();countdownTimer=setInterval(tick,1000);
  }else{
    if(wrap)wrap.hidden=true;
  }
  if(pricingRefreshTimer)clearTimeout(pricingRefreshTimer);
  pricingRefreshTimer=setTimeout(loadAurevaPricing,60000);
}

(async()=>{
  const r=await fetch(`/api/events?slug=${encodeURIComponent(slug||'')}`);if(!r.ok)throw 0;
  const{event:e}=await r.json();
  document.body.dataset.realm=e.realm;
  document.title=`${e.name} - ENTER WILD ONES`;
  text('[data-eyebrow]',e.copy.eyebrow);text('[data-name]',e.name);text('[data-description]',e.copy.description);text('[data-tagline]',e.copy.tagline);
  text('[data-date]',fmt.format(new Date(e.startsAt)));text('[data-age]',`${e.minimumAge}+`);text('[data-status]',e.ticketSalesOpen?'TICKETS OPEN':e.applicationOpen?'ACCESS OPEN':String(e.status).toUpperCase());
  const w=worlds[e.realm];if(w){for(const [key,value] of Object.entries(w))text(`[data-doctrine-${key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}]`,value);}
  if(e.eventId==='aureva-2026')loadAurevaPricing();
  const actions=document.querySelector('[data-actions]'),title=document.querySelector('[data-action-title]'),copy=document.querySelector('[data-action-copy]');
  if(e.accessMode==='public'&&e.ticketSalesOpen){
    const a=document.createElement('a');a.className='button';a.href=`/public-tickets/${encodeURIComponent(e.slug)}`;a.textContent='Get Tickets';actions.prepend(a);title.textContent='PUBLIC TICKETS';copy.textContent=`Register the ticket holder and continue to secure ${e.name} checkout.`;
  }else if(e.applicationOpen&&e.routes.apply){
    const a=document.createElement('a');a.className='button';a.href=e.routes.apply;a.textContent='Request Access';actions.prepend(a);title.textContent='REQUEST ACCESS';copy.textContent=`Submit an access request for ${e.name}.`;
  }else if(e.ticketSalesOpen&&e.accessMode!=='public'){
    title.textContent='INVITATION CHECKOUT';copy.textContent=`${e.name} ticket sales are open for approved guests. Redeem your invitation to verify access and continue to secure checkout.`;
  }else if(e.accessMode==='public'){
    title.textContent='TICKETS COMING SOON';copy.textContent=`Public ticket sales for ${e.name} have not opened yet. Your Wild Ones Passport remains the home for this realm when sales begin.`;
  }else{
    title.textContent='ACCESS NOT YET OPEN';copy.textContent=e.eventId==='aureva-2026'?'AUREVA admission pricing is now published. Checkout remains locked until the final production certification is complete. Existing approved guests can still redeem a valid invitation.':`${e.name} access is not accepting new requests yet. Existing approved guests can still redeem a valid invitation.`;
  }
})().catch(()=>{text('[data-name]','REALM NOT FOUND');text('[data-description]','This realm could not be loaded. Return to The Four Realms and try again.');});
