import { env } from './_env.mjs';
import { requireEvent } from './_events.mjs';

function prefix(eventId){requireEvent(eventId);return `WILDONES_${String(eventId).toUpperCase().replace(/[^A-Z0-9]/g,'_')}`;}
function cents(value){const n=Number(value);return Number.isInteger(n)&&n>=50?n:null;}
function integer(value,min=1,max=100){const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:null;}
export function addonCatalog(eventId){const p=prefix(eventId);const drinkPrice=cents(env(`${p}_DRINK_PACKAGE_PRICE_CENTS`));const drinkCredits=integer(env(`${p}_DRINK_PACKAGE_CREDITS`),1,24);const latePrice=cents(env(`${p}_LATE_STAY_PRICE_CENTS`));const lateDeparture=String(env(`${p}_LATE_STAY_DEPARTURE_TIME`)||'').trim();const aureva=eventId==='aureva-2026';const correctDeparture=!aureva||lateDeparture==='10:00 AM';return [
  {addonType:'drink_package',name:'Drink Package',enabled:Boolean(drinkPrice&&drinkCredits),priceCents:drinkPrice,credits:drinkCredits,description:drinkCredits?`${drinkCredits} prepaid drink credits for the registered ticket holder.`:'Prepaid drink credits.'},
  {addonType:'late_stay',name:'Late Checkout / Car Camping',enabled:Boolean(latePrice&&lateDeparture&&correctDeparture),priceCents:latePrice,departureTime:lateDeparture,description:lateDeparture?(aureva?`Remain after AUREVA ends at 3:00 AM on Sunday, January 24, 2027, until ${lateDeparture} HST. Each person staying after 3:00 AM needs their own add-on.`:`Remain after the event until ${lateDeparture}. Each person staying late needs their own add-on.`):'Late-stay access.'}
];}
export function getAddon(eventId,addonType){return addonCatalog(eventId).find(x=>x.addonType===String(addonType||''))||null;}
export function publicAddon(addon){if(!addon)return null;return{addonType:addon.addonType,name:addon.name,enabled:addon.enabled,priceCents:addon.priceCents,credits:addon.credits||null,departureTime:addon.departureTime||null,description:addon.description};}
