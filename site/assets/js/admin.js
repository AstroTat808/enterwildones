const loginPanel=document.getElementById('loginPanel');
const adminPanel=document.getElementById('adminPanel');
const loginStatus=document.getElementById('loginStatus');
const loginForm=document.getElementById('adminLoginForm');
const adminKey=document.getElementById('adminKey');
const eventSelect=document.getElementById('eventSelect');
const list=document.getElementById('applicationList');
const detail=document.getElementById('applicationDetail');
const notice=document.getElementById('adminNotice');
const searchInput=document.getElementById('adminSearch');
const statusFilter=document.getElementById('adminStatusFilter');
const empty=document.getElementById('adminEmpty');
const visibleCount=document.getElementById('adminVisibleCount');

const uiState={applications:[],selectedId:null,event:null,events:[]};

function esc(v=''){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function realmClass(realm){return ['light','balance','fire','night'].includes(realm)?`realm-${realm}`:'realm-cycle';}
function syncRealm(event){const chip=document.getElementById('adminRealmChip');if(!event)return;document.body.dataset.realm=event.realm||'cycle';if(chip){chip.className=`realm-chip ${realmClass(event.realm)} admin-realm-chip`;const meta=window.WildOnesBrand?.meta(event.realm);chip.textContent=meta?.sub||`${event.name} / ${String(event.realm||'').toUpperCase()}`;}}
function msg(t,c=''){notice.textContent=t;notice.className=`notice ${c}`;notice.classList.remove('hidden');}
function clearMsg(){notice.className='notice hidden';notice.textContent='';}
function formatDate(value){if(!value)return '—';const d=new Date(value);if(Number.isNaN(d.getTime()))return '—';return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(d);}
function formatDateTime(value){if(!value)return '—';const d=new Date(value);if(Number.isNaN(d.getTime()))return '—';return new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short'}).format(d);}
function instagramHandle(value=''){const raw=String(value).trim();if(!raw)return null;const fromUrl=raw.match(/instagram\.com\/([A-Za-z0-9._]+)/i)?.[1];const handle=(fromUrl||raw.replace(/^@/,'').split(/[/?#]/)[0]).trim();return /^[A-Za-z0-9._]{1,30}$/.test(handle)?handle:null;}
function instagramLink(value=''){const h=instagramHandle(value);return h?`https://www.instagram.com/${encodeURIComponent(h)}/`:'';}
function contactLink(label,href){return `<a href="${esc(href)}"${/^https:/i.test(href)?' target="_blank" rel="noopener noreferrer"':''}>${esc(label)}</a>`;}
function state(){return fetch('/api/admin/auth').then(r=>r.json().catch(()=>({}))).then(d=>d.authenticated===true);}

async function login(){
  loginStatus.textContent='Authenticating...';
  const r=await fetch('/api/admin/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:adminKey.value})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){loginStatus.textContent=d.error||'Authentication failed.';adminKey.focus();adminKey.select();return;}
  loginStatus.textContent='';
  await enter();
}

async function enter(){
  loginPanel.classList.add('hidden');
  adminPanel.classList.remove('hidden');
  await load(eventSelect.value||'');
}

function counts(apps){
  const c=apps.reduce((a,x)=>{a[x.status]=(a[x.status]||0)+1;return a;},{});
  document.getElementById('pendingCount').textContent=c.pending||0;
  document.getElementById('approvedCount').textContent=c.approved||0;
  document.getElementById('rejectedCount').textContent=c.rejected||0;
  document.getElementById('totalCount').textContent=apps.length;
}

function filteredApplications(){
  const query=String(searchInput?.value||'').trim().toLowerCase();
  const status=String(statusFilter?.value||'all');
  return uiState.applications.filter(a=>{
    if(status!=='all'&&a.status!==status)return false;
    if(!query)return true;
    return [a.fullName,a.preferredName,a.email,a.phone,a.location,a.instagram,a.referral,a.community,a.whyAttend,a.groupNames].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
}

function statusBadge(status='pending'){return `<span class="admin-badge" data-status="${esc(status)}">${esc(status)}</span>`;}

function renderList(){
  const apps=filteredApplications();
  visibleCount.textContent=apps.length;
  empty.classList.toggle('hidden',apps.length!==0);
  list.innerHTML=apps.map(a=>{
    const selected=a.applicationId===uiState.selectedId?' selected':'';
    const meta=[a.email,a.instagram,a.location].filter(Boolean).join(' · ');
    return `<button type="button" class="admin-application-row${selected}" data-select-id="${esc(a.applicationId)}"><span><strong class="admin-applicant-name">${esc(a.fullName||'Unnamed applicant')}</strong><span class="admin-applicant-meta">${esc(meta||'No contact summary')}</span></span><span class="admin-date">${esc(formatDate(a.createdAt))}</span>${statusBadge(a.status)}</button>`;
  }).join('');
  if(uiState.selectedId&&!uiState.applications.some(a=>a.applicationId===uiState.selectedId)){uiState.selectedId=null;renderDetail();}
}

function fieldCard(label,value,{full=false,html=false}={}){
  const body=value?html?value:esc(value):'<span class="admin-empty-value">Not provided</span>';
  return `<div class="admin-field-card${full?' full':''}"><small>${esc(label)}</small><p>${body}</p></div>`;
}

function renderDetail(){
  const a=uiState.applications.find(x=>x.applicationId===uiState.selectedId);
  if(!a){detail.innerHTML='<div class="admin-detail-placeholder"><p class="admin-kicker">Application review</p><h2>Select a passage request.</h2><p>Choose an applicant from the list to review their complete submission and invitation status.</p></div>';return;}
  const ig=instagramHandle(a.instagram);
  const igHref=instagramLink(a.instagram);
  const contacts=[];
  if(a.email)contacts.push(contactLink('Email applicant',`mailto:${a.email}`));
  if(a.phone)contacts.push(contactLink('Call / text',`tel:${a.phone}`));
  if(ig)contacts.push(contactLink(`@${ig}`,igHref));
  const igField=ig?`<a class="admin-inline-link" href="${esc(igHref)}" target="_blank" rel="noopener noreferrer">@${esc(ig)} ↗</a>`:esc(a.instagram||'');
  const inviteStatus=a.invitationId?`<div class="admin-invite-note"><strong>Invitation created</strong><span>${a.invitationEmailSentAt?`Email sent ${esc(formatDateTime(a.invitationEmailSentAt))}`:`Delivery not confirmed${a.invitationEmailError?` · ${esc(a.invitationEmailError)}`:''}`}</span></div>`:'';
  const actions=a.invitationId?'':`<div class="admin-review-actions"><label class="admin-ticket-limit"><span>Max tickets</span><select data-max><option>1</option><option>2</option><option>3</option><option>4</option></select></label><button class="button" data-action="approve_and_invite" type="button">Approve + Email Invite</button>${a.status==='pending'?'<button class="admin-danger-button" data-action="reject" type="button">Reject</button>':''}</div>`;
  detail.innerHTML=`
    <div class="admin-detail-head"><div><p class="admin-kicker">Passage request</p><h2>${esc(a.fullName||'Unnamed applicant')}</h2><p>Submitted ${esc(formatDateTime(a.createdAt))}</p></div>${statusBadge(a.status)}</div>
    ${contacts.length?`<div class="admin-contact-row">${contacts.join('')}</div>`:''}
    <div class="admin-field-grid">
      ${fieldCard('Preferred name',a.preferredName)}
      ${fieldCard('Location',a.location)}
      ${fieldCard('Email',a.email)}
      ${fieldCard('Mobile',a.phone)}
      ${fieldCard('Instagram',igField,{html:true})}
      ${fieldCard('Referral',a.referral)}
      ${fieldCard('Community / spaces',a.community,{full:true})}
      ${fieldCard(`Why ${uiState.event?.name||'this realm'}`,a.whyAttend,{full:true})}
      ${fieldCard('Applying with',a.groupNames,{full:true})}
      ${fieldCard('Acknowledgements',[a.conductAck?'Conduct ✓':'Conduct missing',a.selectionAck?'Selection ✓':'Selection missing',a.privacyAck?'Privacy ✓':'Privacy missing',a.marketingOptIn?'Marketing opt-in':'No marketing'].join(' · '),{full:true})}
    </div>
    ${inviteStatus}
    ${actions}
    <div class="invite-result hidden" data-result></div>`;
}

async function load(id){
  clearMsg();
  list.innerHTML='<div class="admin-loading">Loading passage requests…</div>';
  const r=await fetch(`/api/admin/applications${id?`?eventId=${encodeURIComponent(id)}`:''}`);
  if(r.status===401){location.reload();return;}
  const d=await r.json().catch(()=>({}));
  if(!r.ok){list.innerHTML=`<div class="notice error">${esc(d.error||'Could not load applications.')}</div>`;return;}
  uiState.applications=d.applications||[];
  uiState.event=d.event;
  uiState.events=d.events||[];
  if(!eventSelect.options.length){for(const e of uiState.events){const o=document.createElement('option');o.value=e.eventId;o.textContent=`${e.name} / ${e.year}`;eventSelect.append(o);}}
  eventSelect.value=d.event.eventId;
  syncRealm(d.event);
  counts(uiState.applications);
  if(!uiState.selectedId||!uiState.applications.some(a=>a.applicationId===uiState.selectedId))uiState.selectedId=uiState.applications[0]?.applicationId||null;
  renderList();
  renderDetail();
}

async function act(button){
  const a=uiState.applications.find(x=>x.applicationId===uiState.selectedId);
  if(!a)return;
  button.disabled=true;
  try{
    const r=await fetch('/api/admin/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:eventSelect.value,applicationId:a.applicationId,action:button.dataset.action,maxTickets:detail.querySelector('[data-max]')?.value||1})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Application update failed.');
    if(d.invite){
      const x=detail.querySelector('[data-result]');
      x.classList.remove('hidden');
      const delivery=d.email?.sent?'EMAIL SENT':'EMAIL NOT CONFIRMED';
      x.innerHTML=`ONE-TIME INVITE: <strong>${esc(d.invite.code)}</strong><br>Expires: ${esc(formatDateTime(d.invite.expiresAt))}<br>${delivery}${d.email?.error?`: ${esc(d.email.error)}`:''}`;
      msg(d.email?.sent?'Invitation generated and emailed.':'Invitation generated, but email delivery failed. Copy the code now and keep Launch Control RED until delivery is verified.',d.email?.sent?'success':'error');
      await load(eventSelect.value);
    }else{
      msg('Application updated.','success');
      await load(eventSelect.value);
    }
  }catch(e){msg(e.message,'error');button.disabled=false;}
}

loginForm.addEventListener('submit',e=>{e.preventDefault();if(!adminKey.value.trim()){loginStatus.textContent='Enter the admin key.';adminKey.focus();return;}login();});
eventSelect.addEventListener('change',()=>{uiState.selectedId=null;load(eventSelect.value);});
document.getElementById('refreshButton').addEventListener('click',()=>load(eventSelect.value));
document.getElementById('logoutLink').addEventListener('click',async e=>{e.preventDefault();await fetch('/api/admin/auth',{method:'DELETE'});location.reload();});
searchInput.addEventListener('input',renderList);
statusFilter.addEventListener('change',renderList);
list.addEventListener('click',e=>{const row=e.target.closest('[data-select-id]');if(!row)return;uiState.selectedId=row.dataset.selectId;renderList();renderDetail();});
detail.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)act(b);});

(async()=>{if(await state())await enter();})();
