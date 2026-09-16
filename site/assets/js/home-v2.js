(() => {
  'use strict';
  const body=document.body;
  const progress=[...document.querySelectorAll('.v2-progress a')];
  const realmNav=[...document.querySelectorAll('.v2-realm-nav a')];
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
  }
  const onScroll=()=>body.classList.toggle('scrolled',scrollY>24);
  onScroll();addEventListener('scroll',onScroll,{passive:true});
  document.querySelectorAll('.mobile-menu a').forEach(a=>a.addEventListener('click',()=>a.closest('details')?.removeAttribute('open')));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.mobile-menu[open]').forEach(menu=>menu.removeAttribute('open'));});
})();
