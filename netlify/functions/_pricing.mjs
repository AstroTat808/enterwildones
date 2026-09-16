import { env } from './_env.mjs';
import { requireEvent } from './_events.mjs';

const AUREVA_DEFAULTS = Object.freeze({
  firstLightPriceCents: 3500,
  fullRadiancePriceCents: 5500,
  firstLightEndsAt: '2026-10-16T00:00:00-10:00'
});

function prefix(eventId) {
  requireEvent(eventId);
  return `WILDONES_${String(eventId).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function cents(value, fallback = null) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 50 ? n : fallback;
}

function validInstant(value, fallback = null) {
  const raw = String(value || fallback || '').trim();
  return raw && Number.isFinite(Date.parse(raw)) ? raw : fallback;
}

export function admissionPricing(eventId, now = Date.now()) {
  const p = prefix(eventId);
  const timestamp = Number(now);

  if (eventId === 'aureva-2026') {
    const firstLightPriceCents = cents(env(`${p}_FIRST_LIGHT_PRICE_CENTS`), AUREVA_DEFAULTS.firstLightPriceCents);
    const fullRadiancePriceCents = cents(env(`${p}_FULL_RADIANCE_PRICE_CENTS`), AUREVA_DEFAULTS.fullRadiancePriceCents);
    const firstLightEndsAt = validInstant(env(`${p}_FIRST_LIGHT_ENDS_AT`), AUREVA_DEFAULTS.firstLightEndsAt);
    const cutoff = Date.parse(firstLightEndsAt);
    const phases = [
      {
        code: 'first_light',
        label: 'FIRST LIGHT RELEASE',
        priceCents: firstLightPriceCents,
        startsAt: null,
        endsAt: firstLightEndsAt,
        displayEndsAt: 'OCT 15 · 11:59 PM HST',
        locked: false
      },
      {
        code: 'full_radiance',
        label: 'FULL RADIANCE',
        priceCents: fullRadiancePriceCents,
        startsAt: firstLightEndsAt,
        endsAt: null,
        displayStartsAt: 'OCT 16 · 12:00 AM HST',
        locked: false
      },
      {
        code: 'zenith',
        label: 'ZENITH',
        priceCents: null,
        startsAt: null,
        endsAt: null,
        locked: true
      }
    ];
    const current = timestamp < cutoff ? phases[0] : phases[1];
    const next = current.code === 'first_light' ? phases[1] : phases[2];
    return {
      eventId,
      currency: 'usd',
      timezone: 'Pacific/Honolulu',
      current,
      next,
      phases,
      transitionAt: firstLightEndsAt
    };
  }

  const fallback = cents(env(`${p}_TICKET_PRICE_CENTS`));
  if (!fallback) return null;
  const current = { code: 'general_admission', label: 'GENERAL ADMISSION', priceCents: fallback, startsAt: null, endsAt: null, locked: false };
  return { eventId, currency: 'usd', timezone: 'Pacific/Honolulu', current, next: null, phases: [current], transitionAt: null };
}

export function currentAdmissionOffer(eventId, now = Date.now()) {
  return admissionPricing(eventId, now)?.current || null;
}

export function currentAdmissionPriceCents(eventId, now = Date.now()) {
  const value = currentAdmissionOffer(eventId, now)?.priceCents;
  return Number.isInteger(value) && value >= 50 ? value : null;
}

export function admissionReleaseProductName(event, offer = currentAdmissionOffer(event.eventId)) {
  if (!offer || offer.code === 'general_admission') return `${event.name} Festival - General Admission`;
  return `${event.name} Festival - ${offer.label}`;
}
