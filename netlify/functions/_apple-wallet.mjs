import { env } from './_env.mjs';
import { getEvent } from './_events.mjs';
import { privateVenue, privateVenueConfigured } from './_venue.mjs';
function cert(name){const b=env(`${name}_BASE64`);if(b)return Buffer.from(b,'base64');const p=env(`${name}_PEM`).replaceAll('\\n','\n').trim();return p?Buffer.from(`${p}\n`):null;}
export function appleWalletConfigured(eventId){return Boolean(getEvent(eventId)&&env('WILDONES_APPLE_PASS_TYPE_ID')&&env('WILDONES_APPLE_TEAM_ID')&&cert('WILDONES_APPLE_WWDR_CERT')&&cert('WILDONES_APPLE_PASS_CERT')&&cert('WILDONES_APPLE_PASS_KEY')&&privateVenueConfigured(eventId));}
export function appleWalletCertificates(){const wwdr=cert('WILDONES_APPLE_WWDR_CERT'),signerCert=cert('WILDONES_APPLE_PASS_CERT'),signerKey=cert('WILDONES_APPLE_PASS_KEY');if(!wwdr||!signerCert||!signerKey)return null;return{wwdr,signerCert,signerKey,...(env('WILDONES_APPLE_PASS_KEY_PASSPHRASE')?{signerKeyPassphrase:env('WILDONES_APPLE_PASS_KEY_PASSPHRASE')}:{})};}
// Snapshot live ticket entitlements when generating a pass. Previously stored
// Wallet passes are not automatically pushed new fields until a Wallet update
// service is configured; the current download reflects the server state.
export function walletAddonFields(addOns = []) {
  const active = Array.isArray(addOns) ? addOns.filter(x => x && x.status === 'active') : [];
  const drink = active.find(x => x.addonType === 'drink_package');
  const late = active.find(x => x.addonType === 'late_stay');
  const auxiliary = [];
  const back = [];
  if (drink) {
    const bought = Number(drink.creditsPurchased || 0);
    const remaining = Number(drink.creditsRemaining ?? bought);
    if (Number.isSafeInteger(bought) && bought >= 1 &&
        Number.isSafeInteger(remaining) && remaining >= 0 && remaining <= bought) {
      auxiliary.push({ key:'drinkCredits', label:'DRINK CREDITS', value:String(remaining) + ' of ' + String(bought) });
      back.push({ key:'drinkPackage', label:'Drink Package', value:String(remaining) + ' of ' + String(bought) + ' prepaid credits remain. Present your active credential to bar staff.' });
    }
  }
  if (late) {
    const until = String(late.departureTime || '').trim();
    if (/^(?:1[0-2]|[1-9]):[0-5][0-9] (?:AM|PM)$/.test(until)) {
      auxiliary.push({ key:'lateStay', label:'LATE CHECKOUT', value:until + ' HST' });
      back.push({ key:'lateStayDetails', label:'Late Checkout / Car Camping', value:'Access approved until ' + until + ' HST. Each guest staying late needs their own add-on.' });
    }
  }
  return { auxiliary, back };
}
function rgb(hex){const h=String(hex||'#000000').replace('#','').padEnd(6,'0').slice(0,6);return`rgb(${parseInt(h.slice(0,2),16)}, ${parseInt(h.slice(2,4),16)}, ${parseInt(h.slice(4,6),16)})`;}
export function buildPass({eventId,ticketId,guestName,ticketUrl,checkedIn=false,addOns=[]}){const event=getEvent(eventId);if(!event||!appleWalletConfigured(eventId))throw new Error('Apple Wallet is not configured for this event.');const venue=privateVenue(eventId);const date=new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:event.timezone}).format(new Date(event.startsAt));const extras=walletAddonFields(addOns);return{formatVersion:1,passTypeIdentifier:env('WILDONES_APPLE_PASS_TYPE_ID'),teamIdentifier:env('WILDONES_APPLE_TEAM_ID'),organizationName:'Wild Ones LLC',description:`${event.name} digital admission ticket`,serialNumber:ticketId,groupingIdentifier:event.eventId,logoText:event.name,foregroundColor:rgb(event.theme.foreground),backgroundColor:rgb(event.theme.background),labelColor:rgb(event.theme.accent),relevantDate:event.startsAt,relevantDates:[{startDate:event.startsAt,endDate:event.endsAt}],expirationDate:new Date(new Date(event.endsAt).getTime()+8*3600000).toISOString(),sharingProhibited:true,barcodes:[{format:'PKBarcodeFormatQR',message:ticketUrl,messageEncoding:'iso-8859-1',altText:ticketId}],eventTicket:{headerFields:[{key:'admission',label:'ADMISSION',value:checkedIn?'CHECKED IN':'VALID'}],primaryFields:[{key:'event',label:'FESTIVAL',value:event.name}],secondaryFields:[{key:'date',label:'DATE',value:date},{key:'realm',label:'REALM',value:event.copy.eyebrow}],auxiliaryFields:[{key:'guest',label:'GUEST',value:guestName||'Wild Ones Guest'},{key:'venue',label:'VENUE',value:venue.name},...extras.auxiliary],backFields:[{key:'ticketId',label:'Ticket ID',value:ticketId},{key:'liveTicket',label:'Current Ticket & Venue Access',value:ticketUrl,attributedValue:`<a href="${ticketUrl}">Open secure digital ticket</a>`},{key:'privacy',label:'Private Access',value:'The current venue address and access instructions are shown only on the secure digital ticket while this admission remains active. Do not share the ticket link or QR code.'},{key:'support',label:'Support',value:env('WILDONES_HELP_EMAIL','help@enterwildones.com')},...extras.back]}};}
