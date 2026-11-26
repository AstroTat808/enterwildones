import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const client=await readFile(new URL('../site/assets/js/passport.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const invited={
  authenticated:true,user:{userId:'refresh-test-user',preferredName:'Test Guest'},
  cycle:{completed:0,total:2,complete:false},
  realms:[
    {event:{slug:'aureva',realm:'light',name:'AUREVA',copy:{tagline:'Realm of Light'},routes:{event:'/events/aureva'}},
      application:{status:'approved'},invitation:{status:'redeemed'},purchaseAvailable:true,ticket:null,entitlements:[],checkedIn:false},
    {event:{slug:'halora',realm:'balance',name:'HALORA',copy:{tagline:'Realm of Balance'},routes:{event:'/events/halora'}},
      ticket:null,entitlements:[],checkedIn:false}
  ]
};
const purchased=clone(invited);
purchased.realms[0].invitation.status='fulfilled';
purchased.realms[0].purchaseAvailable=false;
purchased.realms[0].ticket={status:'paid',ticketId:'WLD-AUR-TEST',ticketUrl:'/ticket?token=signed-test-ticket'};
purchased.realms[0].entitlements=[{addonType:'drink_package',status:'active'},{addonType:'late_stay',status:'active'}];

// Run the actual browser entry point with a small DOM/clock adapter. Requests,
// lifecycle events and returned account data drive the tests; no client state
// or private functions are exported for the harness.
function harness(initial=invited){
  let now=1_000_000,timerId=0,server=clone(initial),getOverride=null,deleteOverride=null,reloads=0;
  const timers=new Map(),requests=[],storage=new Map(),nodes=new Map();
  const handlers=()=>({listeners:new Map(),addEventListener(type,callback){
    if(!this.listeners.has(type))this.listeners.set(type,[]);
    this.listeners.get(type).push(callback);
  },removeEventListener(){},emit(type,details={}){
    for(const callback of this.listeners.get(type)||[])callback({type,currentTarget:this,...details});
  }});
  class Element{
    constructor(tag='div',id=''){
      Object.assign(this,handlers());
      this.tagName=tag.toUpperCase();this.id=id;this.hidden=true;this.dataset={};this.style={};
      this.attributes={};this.children=[];this.className='';this.textContent='';this.disabled=false;
      this.parent=null;this.markup='';this.renderCount=0;
      this.classList={contains:value=>this.className.split(' ').includes(value),add(){},remove(){}};
    }
    setAttribute(name,value){this.attributes[name]=value;}
    getAttribute(name){return this.attributes[name];}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
    replaceChildren(...children){this.children=[];this.markup='';this.append(...children);}
    get innerHTML(){return this.markup;}
    set innerHTML(value){
      this.markup=value;this.renderCount++;this.children=[];
      if(this.id!=='realms')return;
      for(const match of value.matchAll(/<article\b[^>]*data-event-slug="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)){
        const card=new Element('article');card.className='passport-card';card.dataset.eventSlug=match[1];card.markup=match[2];
        for(const action of match[2].matchAll(/<(button|a)\b([^>]*)>([^<]*)<\/\1>/g)){
          const control=new Element(action[1]);control.className=/class="([^"]+)"/.exec(action[2])?.[1]||'';
          control.textContent=action[3];control.disabled=/\bdisabled\b/.test(action[2]);
          const purchase=/data-purchase-event="([^"]+)"/.exec(action[2]);
          if(purchase)control.dataset.purchaseEvent=purchase[1];
          card.append(control);
        }
        const message=new Element('p');message.className='passport-purchase-message';card.append(message);
        this.append(card);
      }
    }
    matches(selector){
      return selector.split(',').some(part=>{
        let term=part.trim();
        if(term.endsWith(':not([disabled])')){
          if(this.disabled)return false;
          term=term.replace(':not([disabled])','');
        }
        if(term==='[data-event-slug]')return Boolean(this.dataset.eventSlug);
        if(term==='[data-purchase-event]')return Boolean(this.dataset.purchaseEvent);
        if(term==='button')return this.tagName==='BUTTON';
        return term.startsWith('.')&&this.classList.contains(term.slice(1));
      });
    }
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    contains(node){return this===node||this.children.some(child=>child.contains(node));}
    closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
    focus(){document.activeElement=this;}
    getBoundingClientRect(){return {width:390};}
    click(){this.onclick?.();this.emit('click');}
  }
  for(const id of ['login','account','status','realms','realmFilter','progress','welcome','cycleFraction',
    'cycleFill','cycleTrack','cycleNodes','passportLoginForm','logout','send','email','passport-turnstile-widget'])
    nodes.set('#'+id,new Element(id==='logout'?'button':'div',id));
  const document={...handlers(),visibilityState:'visible',documentElement:{clientWidth:390},
    querySelector:selector=>nodes.get(selector)||null,createElement:tag=>new Element(tag),
    body:new Element('body'),head:new Element('head')};
  document.activeElement=document.body;
  const navigations=[];
  const location={search:'?paid=true&session_id=untrusted-query',assign(url){navigations.push(url);},reload(){reloads++;}};
  const window={...handlers(),location,
    WildOnesBrand:{meta:()=>({roman:'I',sub:'LIGHT'}),asset:()=>'/test.svg',label:()=> 'Test realm',set(){}},
    turnstile:{render:()=>0,getResponse:()=> 'test-token',reset(){}}};
  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>clone(data)});
  const fetch=async(url,options={})=>{
    requests.push({url,...options});
    if(url==='/api/passport/config')return response({turnstileSiteKey:'test-sitekey'});
    if(url==='/api/passport/ticket-access'){
      assert.equal(options.method,'POST');
      return response({nextUrl:'/ticket-access?event=aureva'});
    }
    assert.equal(url,'/api/passport','Refresh may only request the authenticated Passport endpoint.');
    if(options.method==='DELETE')return deleteOverride?deleteOverride(options):response({ok:true});
    return getOverride?getOverride(options):response(server);
  };
  const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  const advance=async ms=>{
    const target=now+ms;
    for(let count=0;count<1000;count++){
      const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next){now=target;await settle();return;}
      now=next[1].at;timers.delete(next[0]);next[1].callback();await settle();
    }
    assert.fail('Client scheduled an unbounded timer loop.');
  };
  runInNewContext(client,{window,document,location,fetch,AbortController,Promise,console,
    Date:class extends Date{static now(){return now;}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    requestAnimationFrame:callback=>callback(),matchMedia:()=>({matches:true}),
    setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,at:now+delay});return id;},
    clearTimeout:id=>timers.delete(id)});
  return {document,window,nodes,requests,timers,navigations,settle,advance,response,
    setServer:value=>{server=clone(value);},setGet:value=>{getOverride=value;},setDelete:value=>{deleteOverride=value;},
    get calls(){return requests.filter(x=>x.url==='/api/passport'&&!x.method).length;},
    get reloads(){return reloads;},get cards(){return nodes.get('#realms');},
    get selected(){return nodes.get('#realmFilter').children.find(x=>x.attributes['aria-pressed']==='true')?.dataset.realm;}
  };
}

{
  const h=harness();await h.settle();
  assert.match(h.cards.innerHTML,/INVITATION REDEEMED/);
  assert.doesNotMatch(h.cards.innerHTML,/TICKET PURCHASED/,'A payment query parameter is never proof of purchase.');
  assert.equal(h.calls,1);
  const initialRenders=h.cards.renderCount;
  h.window.emit('focus');h.document.emit('visibilitychange');
  await h.settle();
  assert.equal(h.calls,1,'Simultaneous lifecycle events must not burst requests.');
  assert.equal(h.timers.size,1,'There must be only one pending refresh timer.');
  await h.advance(5000);
  assert.equal(h.cards.renderCount,initialRenders,'Unchanged data must preserve existing controls.');

  const filter=h.nodes.get('#realmFilter').children.find(x=>x.dataset.realm==='light');
  filter.click();
  const purchase=h.cards.querySelector('.passport-purchase-cta');purchase.focus();
  h.setServer(purchased);await h.advance(1500);
  h.window.emit('focus');h.document.emit('visibilitychange');await h.settle();
  assert.match(h.cards.innerHTML,/TICKET PURCHASED/);
  assert.match(h.cards.innerHTML,/Open Digital Ticket/);
  assert.match(h.cards.innerHTML,/drink package/);
  assert.match(h.cards.innerHTML,/late stay/);
  assert.doesNotMatch(h.cards.innerHTML,/Purchase Ticket|INVITATION REDEEMED/);
  assert.equal(h.selected,'light','Refreshing must retain the selected realm.');
  assert.equal(h.document.activeElement.classList.contains('passport-ticket-cta'),true,
    'A replaced Purchase Ticket control must hand keyboard focus to the digital ticket.');
  assert.match(h.nodes.get('#progress').textContent,/Ticket purchased/);
  assert.equal(h.timers.size,0,'Polling must stop after the ticket arrives.');
  for(const request of h.requests.filter(x=>!x.method)){
    assert.equal(request.cache,'no-store');assert.equal(request.credentials,'same-origin');
  }
}

{
  const h=harness();await h.settle();
  h.nodes.get('#realmFilter').children.find(x=>x.dataset.realm==='light').click();
  const purchase=h.cards.querySelector('.passport-purchase-cta');purchase.focus();purchase.click();await h.settle();
  assert.equal(purchase.disabled,true);assert.match(purchase.textContent,/Opening secure ticket access/);
  assert.deepEqual(h.navigations,['/ticket-access?event=aureva']);
  h.window.emit('pagehide');
  // The order was cancelled before payment: the server account is unchanged.
  h.window.emit('pageshow',{persisted:true});h.window.emit('focus');h.document.emit('visibilitychange');await h.settle();
  assert.equal(h.selected,'light');
  const restored=h.cards.querySelector('.passport-purchase-cta');
  assert.equal(restored.disabled,false,'Browser back must reset the disabled navigation control.');
  assert.equal(restored.textContent,'Purchase Ticket');
  assert.equal(h.document.activeElement,restored);
  assert.match(h.cards.innerHTML,/Choose your ticket and optional add-ons/);
  assert.equal(h.calls,2,'Restoration and focus must share one server verification.');
}

{
  const h=harness();await h.settle();await h.advance(1000);
  h.document.visibilityState='hidden';h.document.emit('visibilitychange');
  const before=h.calls;
  await h.advance(30000);h.window.emit('focus');await h.settle();
  assert.equal(h.calls,before,'Hidden pages must not poll or react to focus.');
  h.document.visibilityState='visible';h.document.emit('visibilitychange');await h.settle();
  assert.equal(h.calls,before+1,'Returning to a tab must refresh immediately.');
  h.setServer(purchased);await h.advance(5000);
  assert.match(h.cards.innerHTML,/TICKET PURCHASED/,'A delayed webhook result must appear without a reload.');
}

{
  const h=harness();await h.settle();
  await h.advance(125000);
  assert.equal(h.calls,24,'A waiting invitation gets one bounded two-minute window.');
  assert.equal(h.timers.size,0);
  await h.advance(300000);assert.equal(h.calls,24,'An idle tab must not poll forever.');
  h.setServer(purchased);h.window.emit('pagehide');
  h.window.emit('pageshow',{persisted:true});await h.settle();
  assert.equal(h.calls,25);assert.match(h.cards.innerHTML,/TICKET PURCHASED/);
}

{
  const h=harness();await h.settle();
  h.setGet(()=>h.response({error:'Temporary failure'},503));await h.advance(5000);
  assert.equal(h.nodes.get('#account').hidden,false,'A transient refresh failure must not discard the account.');
  assert.equal(h.nodes.get('#login').hidden,true);
  assert.match(h.cards.innerHTML,/INVITATION REDEEMED/);
  assert.match(h.nodes.get('#progress').textContent,/could not refresh/);
  h.setGet(null);await h.advance(5000);
  assert.doesNotMatch(h.nodes.get('#progress').textContent,/could not refresh/);
  h.setGet(()=>h.response({authenticated:false},401));await h.advance(5000);
  assert.equal(h.nodes.get('#account').hidden,true);
  assert.equal(h.nodes.get('#login').hidden,false);
  assert.equal(h.cards.innerHTML,'','Expired sessions must clear private credentials.');
  assert.equal(h.timers.size,0);
}

{
  const h=harness();await h.settle();
  h.setGet(()=>({ok:false,status:401,json:async()=>{throw new SyntaxError('No JSON response');}}));
  await h.advance(5000);
  assert.equal(h.nodes.get('#account').hidden,true,'An empty or non-JSON 401 must clear authentication.');
  assert.equal(h.nodes.get('#login').hidden,false);
  assert.equal(h.cards.innerHTML,'');
  assert.equal(h.timers.size,0);
}

{
  const h=harness();await h.settle();
  h.setGet(options=>new Promise((resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('Aborted'),{name:'AbortError'})));
  }));
  await h.advance(5000);const calls=h.calls;
  h.window.emit('focus');h.document.emit('visibilitychange');await h.settle();
  assert.equal(h.calls,calls,'An outstanding request must be shared.');
  await h.advance(15000);
  assert.equal(h.nodes.get('#account').hidden,false,'A request timeout must retain the last credential.');
  h.setGet(null);h.setServer(purchased);await h.advance(5000);
  assert.match(h.cards.innerHTML,/TICKET PURCHASED/,'A timed-out request must release the refresh lock.');
}

{
  const locked=clone(invited);locked.realms[0].purchaseAvailable=false;
  const h=harness(locked);await h.settle();await h.advance(125000);
  assert.equal(h.calls,1,'Closed sales should not generate checkout polling.');
  assert.equal(h.timers.size,0);
  h.setServer(purchased);h.window.emit('focus');await h.settle();
  assert.match(h.cards.innerHTML,/TICKET PURCHASED/,'A focused Passport still refreshes every account state.');
}

{
  const h=harness();await h.settle();
  let staleResponse;
  // Deliberately ignore abort to verify that late responses cannot restore an
  // account after sign-out, even if an intermediary completes an old request.
  h.setGet(()=>new Promise(resolve=>{staleResponse=resolve;}));
  await h.advance(5000);
  h.nodes.get('#logout').click();await h.settle();
  assert.equal(h.reloads,1);assert.equal(h.cards.innerHTML,'');
  const calls=h.calls;
  staleResponse(h.response(purchased));await h.settle();
  h.window.emit('focus');h.document.emit('visibilitychange');await h.advance(10000);
  assert.equal(h.cards.innerHTML,'');assert.equal(h.calls,calls);
  assert.equal(h.nodes.get('#account').hidden,true);
  assert.equal(h.timers.size,0);
}

{
  const h=harness();await h.settle();
  let staleResponse;
  h.setGet(()=>new Promise(resolve=>{staleResponse=resolve;}));await h.advance(5000);
  h.window.emit('pagehide');
  h.setGet(null);h.setServer(purchased);
  h.window.emit('pageshow',{persisted:true});await h.settle();
  assert.match(h.cards.innerHTML,/TICKET PURCHASED/);
  staleResponse(h.response(invited));await h.settle();
  assert.match(h.cards.innerHTML,/TICKET PURCHASED/,'A superseded response must not undo a payment confirmed after tab restoration.');
  assert.doesNotMatch(h.cards.innerHTML,/Purchase Ticket/);
}

console.log('Passport refresh: verified payment transition, delayed issuance, filter/focus retention, lifecycle deduplication, bounded polling, timeout recovery, expired sessions and stale-response sign-out safety.');
