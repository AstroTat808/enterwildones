(() => {
  'use strict';

  const names = Object.freeze({ light:'aureva', balance:'halora', fire:'sunveil', night:'nocturne', cycle:'enter-wild-ones' });
  const labels = Object.freeze({ light:'AUREVA - Realm I - Light', balance:'HALORA - Realm II - Balance', fire:'SUNVEIL - Realm III - Fire', night:'NOCTURNE - Realm IV - Night', cycle:'Enter Wild Ones - The Four Realms' });
  const valid = value => Object.hasOwn(names,value) ? value : 'cycle';
  const ext = realm => valid(realm)==='cycle' ? 'avif' : 'jpg';
  const asset = realm => `/assets/images/realms/${names[valid(realm)]}.${ext(realm)}`;
  const markAsset = '/assets/images/realms/enter-wild-ones-mark.jpg';

  // Keep the premium visual layer shared by every branded guest/staff page.
  if(!document.querySelector('link[data-wild-ones-polish]')){
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='/assets/css/visual-polish.css';
    link.dataset.wildOnesPolish='';
    document.head.append(link);
  }

  function upgradeStaticArtwork(){
    const map={aureva:'light',halora:'balance',sunveil:'fire',nocturne:'night'};
    document.querySelectorAll('img[src*="/assets/images/realms/"]').forEach(img=>{
      const match=img.getAttribute('src')?.match(/\/realms\/(aureva|halora|sunveil|nocturne)\.(?:avif|jpg)$/i);
      if(match){
        const next=asset(map[match[1].toLowerCase()]);
        if(img.getAttribute('src')!==next)img.src=next;
      }
      img.decoding='async';
    });
    document.querySelectorAll('.brand-icon img').forEach(img=>{
      if(img.getAttribute('src')!==markAsset)img.src=markAsset;
      img.alt='';
      img.width=192;
      img.height=192;
    });
  }

  function sync(){
    const realm=valid(document.body.dataset.realm);
    document.querySelectorAll('[data-brand-logo]').forEach(img=>{
      const key=img.dataset.brandLogo==='auto'?realm:valid(img.dataset.brandLogo);
      if(img.getAttribute('src')!==asset(key))img.src=asset(key);
      if(!img.hasAttribute('data-brand-decorative'))img.alt=labels[key];
    });
    upgradeStaticArtwork();
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
  document.querySelectorAll('.mobile-menu a').forEach(a=>a.addEventListener('click',()=>a.closest('details')?.removeAttribute('open')));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.mobile-menu[open]').forEach(n=>n.removeAttribute('open'));});
})();
