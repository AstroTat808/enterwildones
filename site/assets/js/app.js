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
  const revealNodes=[...document.querySelectorAll('.reveal')];
  const show=node=>node?.classList.add('show');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if('IntersectionObserver' in window&&!reduced){
    const reveal=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){show(e.target);reveal.unobserve(e.target);}},{threshold:.04,rootMargin:'0px 0px 8%'});
    revealNodes.forEach(node=>reveal.observe(node));
    document.documentElement.classList.add('motion-ready');
    const realms=new IntersectionObserver(entries=>{const best=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(best)document.body.dataset.realm=best.target.dataset.realmTrigger||'cycle';},{threshold:[.12,.3,.5],rootMargin:'-10% 0px -10%'});
    document.querySelectorAll('[data-realm-trigger]').forEach(node=>realms.observe(node));
    // Mobile WebKit can occasionally miss IntersectionObserver callbacks during fast
    // programmatic or momentum scrolling. Never leave meaningful content invisible.
    setTimeout(()=>revealNodes.forEach(show),2400);
  }else{
    revealNodes.forEach(show);
  }
  hydrate();
})();
