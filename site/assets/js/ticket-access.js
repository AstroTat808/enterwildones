const params = new URLSearchParams(location.search);
const event = params.get('event') || '';
const name = document.querySelector('#name');
const realm = document.querySelector('#realm');
const release = document.querySelector('#release');
const price = document.querySelector('#price');
const countdown = document.querySelector('#releaseCountdown');
const status = document.querySelector('#status');
const buy = document.querySelector('#buy');
const picker = document.querySelector('#bundle-picker');
const options = document.querySelector('#addon-options');
const admissionLabel = document.querySelector('#bundle-admission-label');
const admissionPrice = document.querySelector('#bundle-admission-price');
const extrasPrice = document.querySelector('#bundle-addon-price');
const totalPrice = document.querySelector('#bundle-total-price');
const money = cents => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2
}).format(Number(cents || 0) / 100);

let countdownTimer = null;
let offerPrice = null;
let catalog = [];
const chosen = new Set();
const disclosurePanel=document.querySelector('#waiver-disclosure'),participantAck=document.querySelector('#participant-waiver-ack'),lateAck=document.querySelector('#late-waiver-ack'),latePanel=document.querySelector('#late-waiver-disclosure');
let disclosure=null,checkoutPending=false;
function updateDisclosure(){latePanel.hidden=!chosen.has('late_stay');buy.disabled=checkoutPending||!disclosure?.participant||!participantAck.checked||(chosen.has('late_stay')&&(!disclosure?.late_stay||!lateAck.checked));}
participantAck.addEventListener('change',updateDisclosure);lateAck.addEventListener('change',updateDisclosure);

function countdownText(ms) {
  if (ms <= 0) return 'Transitioning to the next release…';
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${d}D ${String(h).padStart(2, '0')}H ${String(m).padStart(2, '0')}M ${String(s).padStart(2, '0')}S`;
}

function renderCountdown(offer) {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  if (!offer?.endsAt || offer.phase !== 1) {
    countdown.hidden = true;
    return;
  }
  const target = Date.parse(offer.endsAt);
  countdown.hidden = false;
  const tick = () => {
    const left = target - Date.now();
    countdown.textContent = `FIRST LIGHT FADES IN ${countdownText(left)}`;
    if (left <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      setTimeout(load, 800);
    }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function renderTotals() {
  const addOnCents = catalog
    .filter(item => chosen.has(item.addonType))
    .reduce((sum, item) => sum + item.priceCents, 0);
  admissionPrice.textContent = offerPrice === null ? '—' : money(offerPrice);
  extrasPrice.textContent = money(addOnCents);
  totalPrice.textContent = offerPrice === null ? '—' : money(offerPrice + addOnCents);
}

function createOption(item) {
  const label = document.createElement('label');
  label.className = 'bundle-option';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.name = 'addons';
  checkbox.value = item.addonType;
  checkbox.checked = chosen.has(item.addonType);
  checkbox.setAttribute('aria-label', `Add ${item.name} for ${money(item.priceCents)}`);

  const copy = document.createElement('span');
  copy.className = 'bundle-option-copy';
  const head = document.createElement('span');
  head.className = 'bundle-option-head';
  const title = document.createElement('strong');
  title.className = 'bundle-option-title';
  title.textContent = item.name;
  const amount = document.createElement('span');
  amount.className = 'bundle-option-price';
  amount.textContent = '+ ' + money(item.priceCents);
  head.append(title, amount);
  const description = document.createElement('span');
  description.className = 'bundle-option-description';
  description.textContent = item.description;
  copy.append(head, description);
  label.append(checkbox, copy);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) chosen.add(item.addonType);
    else chosen.delete(item.addonType);
    renderTotals();updateDisclosure();
  });
  return label;
}

function renderOptions(items, offer) {
  catalog = Array.isArray(items) ? items
    .filter(item => item?.enabled && typeof item.addonType === 'string' &&
      Number.isInteger(item.priceCents) && item.priceCents >= 50)
    .slice(0, 2) : [];
  for (const type of [...chosen]) {
    if (!catalog.some(item => item.addonType === type)) chosen.delete(type);
  }
  admissionLabel.textContent = `${offer?.name || 'General'} admission`;
  options.replaceChildren(...catalog.map(createOption));
  picker.hidden = catalog.length === 0;
  renderTotals();
}

async function load() {
  try {
    const response = await fetch(`/api/ticket/access?event=${encodeURIComponent(event)}`, { cache: 'no-store' });
    const info = await response.json().catch(() => ({ error: 'Could not verify ticket access.' }));
    if (info.event) {
      window.WildOnesBrand?.set(info.event);
      name.textContent = info.event.name;
      realm.textContent = info.event.copy.eyebrow;
    }
    if (info.offer?.name) {
      release.hidden = false;
      release.textContent = info.offer.name;
      renderCountdown(info.offer);
    } else {
      release.hidden = true;
      renderCountdown(null);
    }
    offerPrice = Number.isInteger(info.priceCents) ? info.priceCents : null;
    price.textContent = offerPrice === null ? 'PRICE PENDING' : money(offerPrice);
    buy.hidden = true;
    picker.hidden = true;disclosurePanel.hidden=true;
    if (!response.ok || !info.eligible) {
      status.textContent = info.existingTicketId
        ? 'A ticket has already been issued for this invitation.'
        : info.error || (!info.event?.ticketSalesOpen
          ? 'Ticket sales are not open yet.'
          : 'This invitation is not currently eligible for checkout.');
      return;
    }
    if(!info.waiverDisclosure?.participant||!info.waiverDisclosure?.late_stay){status.textContent='Agreement disclosure unavailable. Reload before purchasing.';return;}
    if(JSON.stringify(disclosure)!==JSON.stringify(info.waiverDisclosure)){participantAck.checked=false;lateAck.checked=false;}
    disclosure=info.waiverDisclosure;disclosurePanel.hidden=false;
    document.querySelector('#participant-waiver-preview').href='/waiver-preview?eventId='+encodeURIComponent(info.event.eventId)+'&kind=participant';
    document.querySelector('#late-waiver-preview').href='/waiver-preview?eventId='+encodeURIComponent(info.event.eventId)+'&kind=late_stay';
    renderOptions(info.addons, info.offer);updateDisclosure();
    status.textContent = 'Your invitation is verified. Choose any optional upgrades above, then pay once for your complete order.';
    buy.hidden = false;
  } catch {
    status.textContent = 'We could not verify this invitation. Check your connection and try again.';
    buy.hidden = true;
    picker.hidden = true;
  }
}

buy.addEventListener('click', async () => {
  if (offerPrice === null || buy.disabled) return;
  checkoutPending=true;buy.disabled = true;participantAck.disabled=true;lateAck.disabled=true;
  status.textContent = 'Preparing your complete order in secure checkout…';
  for (const checkbox of options.querySelectorAll('input')) checkbox.disabled = true;
  try {
    const response = await fetch('/api/ticket/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, addons: [...chosen], waiverDisclosure:{participant:{...disclosure.participant,acknowledged:participantAck.checked},late_stay:{...disclosure.late_stay,acknowledged:lateAck.checked}} })
    });
    const result = await response.json().catch(() => ({ error: 'Checkout could not be prepared.' }));
    if (response.ok && result.checkoutUrl) {
      location.assign(result.checkoutUrl);
      return;
    }
    status.textContent = result.error || 'Checkout could not be prepared.';
  } catch {
    status.textContent = 'Checkout could not be prepared. Check your connection before trying again.';
  }
  checkoutPending=false;participantAck.disabled=false;lateAck.disabled=false;updateDisclosure();
  for (const checkbox of options.querySelectorAll('input')) checkbox.disabled = false;
});

load();
