import { env } from './_env.mjs';

function toOrigin(value = '') {
  try { return new URL(String(value).trim()).origin; } catch { return ''; }
}

function firstHeaderValue(value = '') {
  return String(value).split(',')[0].trim();
}

export function sameOrigin(req) {
  const suppliedOrigin = toOrigin(req.headers.get('origin') || '');
  if (!suppliedOrigin) return !String(req.headers.get('origin') || '').trim();

  const requestOrigin = toOrigin(req.url);
  const forwardedHost = firstHeaderValue(req.headers.get('x-forwarded-host') || req.headers.get('host') || '');
  const forwardedProto = firstHeaderValue(req.headers.get('x-forwarded-proto') || '') || (requestOrigin ? new URL(requestOrigin).protocol.replace(':', '') : 'https');
  const forwardedOrigin = forwardedHost ? toOrigin(`${forwardedProto}://${forwardedHost}`) : '';
  const configuredOrigin = toOrigin(env('WILDONES_SITE_URL'));

  const allowed = new Set([requestOrigin, forwardedOrigin, configuredOrigin].filter(Boolean));
  if (configuredOrigin) {
    try {
      const configured = new URL(configuredOrigin);
      const aliasHost = configured.hostname.startsWith('www.') ? configured.hostname.slice(4) : `www.${configured.hostname}`;
      allowed.add(`${configured.protocol}//${aliasHost}${configured.port ? `:${configured.port}` : ''}`);
    } catch {}
  }

  return allowed.has(suppliedOrigin);
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const key = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    try { value = decodeURIComponent(value); } catch {}
    if (key) out[key] = value;
  }
  return out;
}
