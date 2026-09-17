(() => {
  'use strict';
  const body=document.body;
  const progress=[...document.querySelectorAll('.v2-progress a')];
  const realmNav=[...document.querySelectorAll('.v2-realm-nav a')];
  const realmNavGroup=document.querySelector('.v2-realm-nav');
  const sections=[...document.querySelectorAll('.v2-realm[data-brand-realm]')];
  const allLinks=[...progress,...realmNav];
  const setCurrent=id=>{
    allLinks.forEach(link=>link.setAttribute('aria-current',link.getAttribute('href')===`#${id}`?'true':'false'));
  };
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{
      const current=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
      if(current)setCurrent(current.target.id);
    },{threshold:[.18,.35,.55],rootMargin:'-20% 0px -35%'});
    sections.forEach(section=>observer.observe(section));

    if(realmNavGroup && !matchMedia('(prefers-reduced-motion: reduce)').matches){
      const sweepObserver=new IntersectionObserver(entries=>{
        const visible=entries.find(entry=>entry.isIntersecting);
        if(!visible)return;
        realmNavGroup.classList.add('is-first-view');
        sweepObserver.disconnect();
      },{threshold:.32,rootMargin:'0px 0px -8%'});
      sweepObserver.observe(realmNavGroup);
    }
  }
  const onScroll=()=>body.classList.toggle('scrolled',scrollY>24);
  onScroll();addEventListener('scroll',onScroll,{passive:true});
  document.querySelectorAll('.mobile-menu a').forEach(a=>a.addEventListener('click',()=>a.closest('details')?.removeAttribute('open')));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.mobile-menu[open]').forEach(menu=>menu.removeAttribute('open'));});
})();
