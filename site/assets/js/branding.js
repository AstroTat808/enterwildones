(() => {
  'use strict';
  const names = Object.freeze({light:'aureva',balance:'halora',fire:'sunveil',night:'nocturne',cycle:'enter-wild-ones'});
  const labels = Object.freeze({light:'AUREVA - Realm I - Light',balance:'HALORA - Realm II - Balance',fire:'SUNVEIL - Realm III - Fire',night:'NOCTURNE - Realm IV - Night',cycle:'Enter Wild Ones - The Four Realms'});
  const valid = value => Object.hasOwn(names,value) ? value : 'cycle';
  const asset = realm => `/assets/images/realms/${names[valid(realm)]}.avif`;
  function sync(){
    const realm=valid(document.body.dataset.realm);
    document.querySelectorAll('[data-brand-logo]').forEach(img=>{
      const key=img.dataset.brandLogo==='auto'?realm:valid(img.dataset.brandLogo);
      if(img.getAttribute('src')!==asset(key))img.src=asset(key);
      if(!img.hasAttribute('data-brand-decorative'))img.alt=labels[key];
    });
  }
  function set(event){
    if(!event||!Object.hasOwn(names,event.realm))return;
    document.body.dataset.realm=event.realm;
    document.body.dataset.eventId=event.eventId||'';
    sync();
  }
  window.WildOnesBrand=Object.freeze({asset,set,sync,label:realm=>labels[valid(realm)]});
  const path=location.pathname.split('/').filter(Boolean);
  const slug=new URLSearchParams(location.search).get('event')||(['events','apply','public-tickets'].includes(path[0])?path[1]:'');
  const key=Object.keys(names).find(k=>names[k]===slug);
  if(key)document.body.dataset.realm=key;
  sync();
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-realm']});
  document.querySelectorAll('.mobile-menu a').forEach(a=>a.addEventListener('click',()=>a.closest('details').removeAttribute('open')));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.mobile-menu[open]').forEach(n=>n.removeAttribute('open'));});
})();
