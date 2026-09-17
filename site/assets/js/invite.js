const form=document.getElementById('inviteForm'),status=document.getElementById('inviteStatus');
form.addEventListener('submit',async e=>{
  e.preventDefault();
  const b=form.querySelector('button');
  b.disabled=true;
  status.textContent='Verifying...';
  try{
    const code=new FormData(form).get('code');
    const r=await fetch('/api/redeem-invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Invitation could not be redeemed.');
    const ev=d.event;
    document.body.dataset.realm=ev.realm;
    form.classList.add('hidden');
    const g=document.getElementById('granted');
    g.classList.remove('hidden');
    g.querySelector('[data-granted-name]').textContent=ev.name;
    const purchaseAvailable=Boolean(d.purchaseAvailable);
    g.querySelector('[data-granted-copy]').textContent=purchaseAvailable?'Your invitation is verified. Taking you to secure ticket access…':'Your invitation is verified. Ticket sales for this realm are not open yet.';
    const a=g.querySelector('[data-next-link]');
    a.href=d.nextUrl||ev.routes.event;
    a.textContent=purchaseAvailable?'Continue to Tickets':`View ${ev.name}`;
    if(purchaseAvailable&&d.nextUrl){setTimeout(()=>location.assign(d.nextUrl),350);}
  }catch(err){status.textContent=err.message;}
  finally{b.disabled=false;}
});
