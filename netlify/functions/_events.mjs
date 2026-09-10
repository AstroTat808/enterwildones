const TIMEZONE = 'Pacific/Honolulu';

export const CYCLE_ID = 'wild-ones-cycle-2026-2027';

export const EVENTS = Object.freeze({
  'aureva-2026': Object.freeze({
    eventId: 'aureva-2026', cycleId: CYCLE_ID, cycleOrder: 1, realm: 'light', name: 'AUREVA', slug: 'aureva', year: 2026,
    status: 'announced', visibility: 'public', startsAt: '2026-12-12T15:00:00-10:00', endsAt: '2026-12-13T03:00:00-10:00', timezone: TIMEZONE,
    accessMode: 'application', minimumAge: 21, applicationOpen: false, ticketSalesOpen: false,
    routes: { event: '/events/aureva', apply: '/apply/aureva' },
    copy: { eyebrow: 'Realm I · Light', tagline: 'Enter the Light', description: 'A luminous end-of-year electronic experience where the Wild Ones cycle begins.' },
    theme: { accent: '#d9ad5b', accentSecondary: '#fff1ce', background: '#100d08', foreground: '#fffaf0' }
  }),
  'halora-2027': Object.freeze({
    eventId: 'halora-2027', cycleId: CYCLE_ID, cycleOrder: 2, realm: 'balance', name: 'HALORA', slug: 'halora', year: 2027,
    status: 'planned', visibility: 'public', startsAt: '2027-03-20T15:00:00-10:00', endsAt: '2027-03-21T03:00:00-10:00', timezone: TIMEZONE,
    accessMode: 'application_then_public', minimumAge: 21, applicationOpen: false, ticketSalesOpen: false,
    routes: { event: '/events/halora', apply: '/apply/halora' },
    copy: { eyebrow: 'Realm II · Balance', tagline: 'Perfectly Aligned', description: 'An equinox gathering suspended between light and shadow, symmetry and release.' },
    theme: { accent: '#56e7dd', accentSecondary: '#9b78ff', background: '#080a12', foreground: '#f7fbff' }
  }),
  'sunveil-2027': Object.freeze({
    eventId: 'sunveil-2027', cycleId: CYCLE_ID, cycleOrder: 3, realm: 'fire', name: 'SUNVEIL', slug: 'sunveil', year: 2027,
    status: 'planned', visibility: 'public', startsAt: '2027-06-19T15:00:00-10:00', endsAt: '2027-06-20T03:00:00-10:00', timezone: TIMEZONE,
    accessMode: 'public', minimumAge: 21, applicationOpen: false, ticketSalesOpen: false,
    routes: { event: '/events/sunveil', apply: null },
    copy: { eyebrow: 'Realm III · Fire', tagline: 'Chase the Sun', description: 'A tropical progression from daylight to sunset to a fully illuminated night.' },
    theme: { accent: '#ff8a43', accentSecondary: '#d14fff', background: '#12070d', foreground: '#fff6f0' }
  }),
  'nocturne-2027': Object.freeze({
    eventId: 'nocturne-2027', cycleId: CYCLE_ID, cycleOrder: 4, realm: 'night', name: 'NOCTURNE', slug: 'nocturne', year: 2027,
    status: 'planned', visibility: 'public', startsAt: '2027-09-05T15:00:00-10:00', endsAt: '2027-09-06T03:00:00-10:00', timezone: TIMEZONE,
    accessMode: 'application', minimumAge: 21, applicationOpen: false, ticketSalesOpen: false,
    routes: { event: '/events/nocturne', apply: '/apply/nocturne' },
    copy: { eyebrow: 'Realm IV · Night', tagline: 'Enter the Night', description: 'The flagship realm: private, celestial and intentionally scarce.' },
    theme: { accent: '#d9a33b', accentSecondary: '#f2d08c', background: '#030303', foreground: '#fff5e5' }
  })
});

const PUBLIC_FIELDS = ['eventId','cycleId','cycleOrder','realm','name','slug','year','status','visibility','startsAt','endsAt','timezone','accessMode','minimumAge','applicationOpen','ticketSalesOpen','routes','copy','theme'];

export function getEvent(eventId) { return EVENTS[String(eventId || '').trim()] || null; }
export function getEventBySlug(slug) { const normalized = String(slug || '').trim().toLowerCase(); return Object.values(EVENTS).find((event) => event.slug === normalized) || null; }
export function requireEvent(eventId) { const event = getEvent(eventId); if (!event) { const error = new Error('Unknown eventId.'); error.code = 'UNKNOWN_EVENT'; error.status = 400; throw error; } return event; }
export function listEvents({ includeHidden = false } = {}) { return Object.values(EVENTS).filter((event) => includeHidden || event.visibility === 'public').sort((a,b) => a.cycleOrder - b.cycleOrder); }
export function toPublicEvent(event) { if (!event) return null; return Object.fromEntries(PUBLIC_FIELDS.map((key) => [key, event[key]])); }
