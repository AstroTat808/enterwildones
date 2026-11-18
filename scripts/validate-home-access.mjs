import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {EVENTS} from '../netlify/functions/_events.mjs';

const html=await readFile(new URL('../site/index.html',import.meta.url),'utf8');
const js=await readFile(new URL('../site/assets/js/app.js',import.meta.url),'utf8');
const aureva=EVENTS['aureva-2026'];
assert.equal(aureva.applicationOpen,true);
assert.equal(aureva.routes.apply,'/apply/aureva');
assert.match(html,/<a data-event-status href="\/apply\/aureva">REQUEST ACCESS<\/a>/);
assert.match(html,/<a class="v2-realm-link" href="\/events\/aureva">Discover AUREVA<\/a>/);

class FakeElement {
  constructor(tagName,attributes={}){
    this.tagName=tagName.toUpperCase();
    this.dataset={...attributes};
    this.textContent='';
    this.href='';
    this.replacement=null;
    this.classList={add(){}};
  }
  replaceWith(element){this.replacement=element;}
}

async function hydrate(event,initialTag){
  const status=new FakeElement(initialTag,{eventStatus:''});
  status.href=initialTag==='a'?'/apply/aureva':'';
  const date=new FakeElement('span');
  const card={querySelector(selector){return selector==='[data-event-date]'?date:status;}};
  const document={
    querySelector(selector){return selector.startsWith('[data-event-id=')?card:null;},
    querySelectorAll(){return [];},
    createElement(tag){return new FakeElement(tag);},
  };
  const context={
    document,
    CSS:{escape:s=>s},
    window:{},
    Intl,Date,
    matchMedia:()=>({matches:true}),
    fetch:async()=>({ok:true,json:async()=>({events:[event]})}),
  };
  vm.runInNewContext(js,context);
  await new Promise(resolve=>setImmediate(resolve));
  return status.replacement||status;
}

const open=await hydrate(aureva,'a');
assert.equal(open.tagName,'A');
assert.equal(open.href,'/apply/aureva');
assert.equal(open.textContent,'REQUEST ACCESS');

const closed=await hydrate({...aureva,applicationOpen:false,status:'announced'},'a');
assert.equal(closed.tagName,'SPAN');
assert.equal(closed.textContent,'ANNOUNCED');

const reopened=await hydrate(aureva,'span');
assert.equal(reopened.tagName,'A');
assert.equal(reopened.href,'/apply/aureva');

const publicSales=await hydrate({...aureva,applicationOpen:false,ticketSalesOpen:true,accessMode:'public'},'span');
assert.equal(publicSales.href,'/public-tickets/aureva');
assert.equal(publicSales.textContent,'TICKETS OPEN');

const inviteSales=await hydrate({...aureva,ticketSalesOpen:true},'a');
assert.equal(inviteSales.href,'/invite');
assert.equal(inviteSales.textContent,'INVITED GUEST CHECKOUT');

console.log('AUREVA homepage access link and status transitions validated.');
