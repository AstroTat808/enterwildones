(() => {
  'use strict';

  const realms = Object.freeze({
    cycle:{slug:'enter-wild-ones',name:'ENTER WILD ONES',sub:'THE FOUR REALMS',label:'Enter Wild Ones - The Four Realms',roman:'∞'},
    light:{slug:'aureva',name:'AUREVA',sub:'REALM I · LIGHT',label:'AUREVA - Realm I - Light',roman:'I'},
    balance:{slug:'halora',name:'HALORA',sub:'REALM II · BALANCE',label:'HALORA - Realm II - Balance',roman:'II'},
    fire:{slug:'sunveil',name:'SUNVEIL',sub:'REALM III · FIRE',label:'SUNVEIL - Realm III - Fire',roman:'III'},
    night:{slug:'nocturne',name:'NOCTURNE',sub:'REALM IV · NIGHT',label:'NOCTURNE - Realm IV - Night',roman:'IV'}
  });
  const valid = value => Object.hasOwn(realms,value) ? value : 'cycle';
  const asset = realm => `/assets/images/realms/${realms[valid(realm)].slug}-1200.webp`;
  const canonicalHome = document.body.classList.contains('cinematic-home');

  // The public homepage now owns its complete visual system in /assets/css/home.css.
  // Keep shared lockup/optical support, but do not re-inject historical global polish
  // layers that would reintroduce cascade conflicts on the canonical homepage.
  if(!canonicalHome && !document.querySelector('link[data-wild-ones-polish]')){
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='/assets/css/visual-polish.css';
    link.dataset.wildOnesPolish='';
    document.head.append(link);
  }
  if(!document.querySelector('link[data-wild-ones-retina]')){
    const retina=document.createElement('link');
    retina.rel='stylesheet';
    retina.href='/assets/css/retina-lockups.css';
    retina.dataset.wildOnesRetina='';
    document.head.append(retina);
  }
  if(!document.querySelector('link[data-wild-ones-logo-optics]')){
    const optics=document.createElement('link');
    optics.rel='stylesheet';
    optics.href='/assets/css/logo-optics.css';
    optics.dataset.wildOnesLogoOptics='';
    document.head.append(optics);
  }
  if(!canonicalHome && !document.querySelector('link[data-wild-ones-prelaunch]')){
    const prelaunch=document.createElement('link');
    prelaunch.rel='stylesheet';
    prelaunch.href='/assets/css/prelaunch-polish.css';
    prelaunch.dataset.wildOnesPrelaunch='';
    document.head.append(prelaunch);
  }

  function lockup(realm, variant='page'){
    const key=valid(realm), meta=realms[key];
    const wrap=document.createElement('div');
    wrap.className=`web-lockup web-lockup--official ${variant}-lockup`;
    wrap.dataset.webRealm=key;
    wrap.dataset.webVariant=variant;
    wrap.innerHTML=`<img class="web-lockup-art" src="${asset(key)}" alt="" decoding="sync">`;
    wrap.setAttribute('role','img');
    wrap.setAttribute('aria-label',meta.label);
    return wrap;
  }

  function replaceWithLockup(container, realm, variant){
    if(!container)return;
    const key=valid(realm);
    const existing=container.querySelector(':scope > .web-lockup');
    if(existing && existing.dataset.webRealm===key && existing.dataset.webVariant===variant)return existing;
    const next=lockup(key,variant);
    container.replaceChildren(next);
    return next;
  }

  function inferRealmFromImage(img){
    const src=(img?.getAttribute('src')||img?.dataset?.src||'').toLowerCase();
    for(const [key,meta] of Object.entries(realms)){
      if(src.includes(`/${meta.slug}.`)||src.includes(`/${meta.slug}-`))return key;
    }
    return 'cycle';
  }

  function upgradeHeader(){
    document.querySelectorAll('.brand').forEach(brand=>{
      let icon=brand.querySelector('.brand-icon');
      if(!icon){
        icon=document.createElement('span');
        icon.className='brand-icon';
        icon.setAttribute('aria-hidden','true');
        brand.prepend(icon);
      }
      let img=icon.querySelector('img');
      if(!img){img=document.createElement('img');icon.append(img);}
      img.src=asset('cycle');
      img.alt='';
      img.decoding='sync';
    });
  }

  function upgradeHomeArtwork(){
    const hero=document.querySelector('.hero-logo-wrap');
    if(hero)replaceWithLockup(hero,'cycle','master');
    document.querySelectorAll('.realm-logo-frame').forEach(frame=>{
      const section=frame.closest('[data-brand-realm],[data-realm-trigger]');
      const key=valid(section?.dataset.brandRealm||section?.dataset.realmTrigger||inferRealmFromImage(frame.querySelector('img')));
      replaceWithLockup(frame,key,'realm');
      if(section && !section.dataset.portalRoman)section.dataset.portalRoman=realms[key].roman;
    });
  }

  function upgradePageArtwork(){
    const current=valid(document.body.dataset.realm);
    document.querySelectorAll('.page-brand').forEach(container=>{
      const img=container.querySelector('[data-brand-logo],img');
      const requested=img?.dataset.brandLogo;
      const key=requested && requested!=='auto' ? valid(requested) : current;
      replaceWithLockup(container,key,container.classList.contains('compact')?'compact':'page');
    });
    document.querySelectorAll('.footer-brand').forEach(container=>replaceWithLockup(container,'cycle','footer'));
  }

  function addCosmos(){
    if(document.querySelector('.wo-cosmos'))return;
    const cosmos=document.createElement('div');
    cosmos.className='wo-cosmos'; cosmos.setAttribute('aria-hidden','true');
    const stars=document.createElement('div'); stars.className='wo-stars';
    let seed=137;
    const rand=()=>{seed=(seed*9301+49297)%233280;return seed/233280;};
    for(let i=0;i<64;i++){
      const star=document.createElement('i');
      star.style.setProperty('--x',`${(rand()*100).toFixed(2)}%`);
      star.style.setProperty('--y',`${(rand()*100).toFixed(2)}%`);
      star.style.setProperty('--s',`${(0.7+rand()*2.0).toFixed(2)}px`);
      star.style.setProperty('--o',`${(0.24+rand()*0.66).toFixed(2)}`);
      star.style.setProperty('--d',`${(3.8+rand()*6.8).toFixed(2)}s`);
      star.style.setProperty('--delay',`${(-rand()*7).toFixed(2)}s`);
      stars.append(star);
    }
    cosmos.append(stars);
    document.body.prepend(cosmos);
  }

  function motion(){
    const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduce)return;
    let ticking=false;
    const render=()=>{
      ticking=false;
      const max=Math.max(document.documentElement.scrollHeight-innerHeight,1);
      document.documentElement.style.setProperty('--wo-scroll',(scrollY/max).toFixed(4));
    };
    addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(render);}},{passive:true});
    render();
    if(matchMedia('(pointer:fine)').matches){
      addEventListener('pointermove',e=>{
        const x=((e.clientX/innerWidth)-.5)*18;
        const y=((e.clientY/innerHeight)-.5)*18;
        document.documentElement.style.setProperty('--wo-pointer-x',`${x.toFixed(2)}px`);
        document.documentElement.style.setProperty('--wo-pointer-y',`${y.toFixed(2)}px`);
      },{passive:true});
    }
  }

  function sync(){
    const realm=valid(document.body.dataset.realm);
    document.querySelectorAll('[data-brand-logo]').forEach(img=>{
      const key=img.dataset.brandLogo==='auto'?realm:valid(img.dataset.brandLogo);
      if(img.getAttribute('src')!==asset(key))img.src=asset(key);
      if(!img.hasAttribute('data-brand-decorative'))img.alt=realms[key].label;
    });
    upgradeHeader();
    upgradeHomeArtwork();
    upgradePageArtwork();
  }

  function set(event){
    if(!event||!Object.hasOwn(realms,event.realm))return;
    document.body.dataset.realm=event.realm;
    document.body.dataset.eventId=event.eventId||'';
    sync();
  }

  window.WildOnesBrand=Object.freeze({asset,set,sync,label:realm=>realms[valid(realm)].label,lockup});

  const path=location.pathname.split('/').filter(Boolean);
  const slug=new URLSearchParams(location.search).get('event')||(['events','apply','public-tickets'].includes(path[0])?path[1]:'');
  const inferred=Object.keys(realms).find(k=>realms[k].slug===slug);
  if(inferred)document.body.dataset.realm=inferred;
  if(!document.body.dataset.realm)document.body.dataset.realm='cycle';

  if(!canonicalHome)addCosmos();
  sync();
  motion();
  requestAnimationFrame(()=>document.documentElement.classList.add('motion-ready'));

  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-realm']});
  document.querySelectorAll('.mobile-menu a').forEach(a=>a.addEventListener('click',()=>a.closest('details')?.removeAttribute('open')));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.mobile-menu[open]').forEach(n=>n.removeAttribute('open'));});
})();