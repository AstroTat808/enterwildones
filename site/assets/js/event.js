const slug=new URLSearchParams(location.search).get('event')||location.pathname.split('/').filter(Boolean).pop();
const fmt=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'Pacific/Honolulu'});
const worlds=Object.freeze({
  light:{index:'REALM I / LIGHT',title:'Begin in radiance.',energyTitle:'Awaken',energyCopy:'Warm, expansive and ceremonial. AUREVA is the first opening of the cycle: a world designed around emergence, connection and the feeling of stepping into first light.',soundTitle:'Ascend',soundCopy:'Melodic electronic music, luminous builds and euphoric release shape an upward arc from arrival through the final hours.',ritualTitle:'Arrive',ritualCopy:'The first realm establishes the Wild Ones language. Cross the threshold, leave the ordinary outside and begin the cycle together.'},
  balance:{index:'REALM II / BALANCE',title:'Stand between worlds.',energyTitle:'Align',energyCopy:'HALORA lives at the equinox: equal parts light and shadow, restraint and release. Its atmosphere is intentional, symmetrical and suspended between opposites.',soundTitle:'Resolve',soundCopy:'Tension and harmony trade places throughout the night. Rhythmic precision, contrast and carefully timed release create the realm’s equilibrium.',ritualTitle:'Center',ritualCopy:'This is the midpoint state: neither beginning nor ending. Enter with the cycle already in motion and find the moment where opposing forces become one.'},
  fire:{index:'REALM III / FIRE',title:'Move with the horizon.',energyTitle:'Ignite',energyCopy:'SUNVEIL is heat, daylight and motion. The realm begins under the sun and intensifies as color drains from the horizon and the night takes over.',soundTitle:'Accelerate',soundCopy:'Bright daytime momentum gives way to heavier nighttime energy. The musical arc follows the sun instead of fighting it.',ritualTitle:'Release',ritualCopy:'SUNVEIL is the least restrained realm: movement first, spectacle second, surrender always. Chase the final light and cross into night at full velocity.'},
  night:{index:'REALM IV / NIGHT',title:'Disappear after dark.',energyTitle:'Descend',energyCopy:'NOCTURNE is private, celestial and scarce. Darkness is not decoration here; it is the architecture of the realm and the final state of the cycle.',soundTitle:'Immerse',soundCopy:'Deep atmosphere, high-impact electronic music and late-night intensity create a world that feels separated from everything beyond its boundary.',ritualTitle:'Return',ritualCopy:'The cycle closes in secrecy. Invitation, arrival and access are part of the experience itself, ending where Wild Ones is most mysterious.'}
});
const text=(selector,value)=>{const node=document.querySelector(selector);if(node)node.textContent=value;};
(async()=>{
  const r=await fetch(`/api/events?slug=${encodeURIComponent(slug||'')}`);if(!r.ok)throw 0;
  const{event:e}=await r.json();
  document.body.dataset.realm=e.realm;
  document.title=`${e.name} - ENTER WILD ONES`;
  text('[data-eyebrow]',e.copy.eyebrow);text('[data-name]',e.name);text('[data-description]',e.copy.description);text('[data-tagline]',e.copy.tagline);
  text('[data-date]',fmt.format(new Date(e.startsAt)));text('[data-age]',`${e.minimumAge}+`);text('[data-status]',e.ticketSalesOpen?'TICKETS OPEN':e.applicationOpen?'ACCESS OPEN':String(e.status).toUpperCase());
  const w=worlds[e.realm];if(w){for(const [key,value] of Object.entries(w))text(`[data-doctrine-${key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}]`,value);}
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
    title.textContent='ACCESS NOT YET OPEN';copy.textContent=`${e.name} access is not accepting new requests yet. Existing approved guests can still redeem a valid invitation.`;
  }
})().catch(()=>{text('[data-name]','REALM NOT FOUND');text('[data-description]','This realm could not be loaded. Return to The Four Realms and try again.');});
