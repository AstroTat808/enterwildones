// Only server-validated event realms select public artwork; never use ticket data as a path.
const artwork=Object.freeze({light:'aureva',balance:'halora',fire:'sunveil',night:'nocturne',cycle:'enter-wild-ones'});
export function realmArtwork(realm){return `/assets/images/realms/${(Object.hasOwn(artwork,realm)?artwork[realm]:artwork.cycle)}.avif`;}
export function realmLogo(event,cls='ticket-logo'){
  const name=(Object.hasOwn(artwork,event?.realm)?artwork[event.realm]:artwork.cycle);
  return `<img class="${cls}" src="${realmArtwork(event?.realm)}" alt="${name.replaceAll('-',' ').toUpperCase()}" width="768" height="768">`;
}
export const brandStyles='<link rel="stylesheet" href="/assets/css/branding.css">';
export const ticketHeader='<header class="ticket-brand-header"><a href="/">ENTER WILD ONES</a><a href="/passport">MY PASSPORT</a></header>';
