(() => {
  'use strict';
  const fmt=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'Pacific/Honolulu'});
  async function hydrate(){
    try{
      const r=await fetch('/api/events');if(!r.ok)return;
      const data=await r.json();
      for(const e of data.events||[]){
        const card=document.querySelector(`[data-event-id="${CSS.escape(e.eventId)}"]`);if(!card)continue;
        const date=card.querySelector('[data-event-date]'),status=card.querySelector('[data-event-status]');
        if(date)date.textContent=fmt.format(new Date(e.startsAt)).toUpperCase();
        if(status)status.textContent=e.ticketSalesOpen?(e.accessMode==='public'?'TICKETS OPEN':'INVITED GUEST CHECKOUT'):e.applicationOpen?'REQUEST ACCESS':String(e.status||'COMING SOON').replaceAll('_',' ').toUpperCase();
      }
    }catch{/* Server-rendered event summaries remain readable if hydration fails. */}
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if('IntersectionObserver' in window&&!reduced){
    const reveal=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){e.target.classList.add('show');reveal.unobserve(e.target);}},{threshold:.06});
    document.querySelectorAll('.reveal').forEach(node=>reveal.observe(node));
    document.documentElement.classList.add('motion-ready');
    const realms=new IntersectionObserver(entries=>{const best=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(best)document.body.dataset.realm=best.target.dataset.realmTrigger||'cycle';},{threshold:[.15,.35,.55],rootMargin:'-12% 0px -12%'});
    document.querySelectorAll('[data-realm-trigger]').forEach(node=>realms.observe(node));
  }
  hydrate();
})();
