import { env } from './_env.mjs';
import { blobStore } from './_blob-store.mjs';
import { createAdminSession, adminSessionCookie, clearAdminSessionCookie, isAdmin } from './_admin-auth.mjs';
import { clean, clientIp, json, readBody } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { STORES, sha256 } from './_stores.mjs';
import { timingSafeEqual } from 'node:crypto';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
function equal(a = '', b = '') { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }
async function loginState(req) { const store = blobStore(STORES.rateLimits); const key = `admin-login/ip/${sha256(clientIp(req))}`; const state = await store.get(key, { type: 'json' }).catch(() => null); return { store, key, state }; }
export default async (req) => {
  if (req.method === 'GET') return json({ authenticated: isAdmin(req) });
  if (!sameOrigin(req)) return json({ error: 'Origin not allowed.' }, 403);
  if (req.method === 'DELETE') return json({ authenticated: false }, 200, { 'Set-Cookie': clearAdminSessionCookie() });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const expected = env('WILDONES_ADMIN_KEY');
  if (!expected || !env('WILDONES_ADMIN_SESSION_SECRET')) return json({ error: 'Admin authentication is not configured.' }, 503);
  let body;
  try { body = await readBody(req); } catch { return json({ error: 'Invalid request.' }, 400); }
  let rate;
  try { rate = await loginState(req); } catch { return json({ error: 'Admin authentication is temporarily unavailable.' }, 503); }
  const now = Date.now();
  const active = rate.state && Number(rate.state.windowStart) > now - WINDOW_MS ? rate.state : { windowStart: now, failures: 0 };
  if (Number(active.failures) >= MAX_FAILURES) return json({ error: 'Too many failed admin login attempts. Try again later.' }, 429, { 'Retry-After': String(Math.max(60, Math.ceil((Number(active.windowStart) + WINDOW_MS - now) / 1000))) });
  const supplied = clean(body.key, 1024);
  if (!supplied || !equal(supplied, expected)) {
    await rate.store.setJSON(rate.key, { windowStart: Number(active.windowStart), failures: Number(active.failures) + 1, updatedAt: new Date().toISOString() }).catch(() => {});
    return json({ error: 'Invalid admin key.' }, 401);
  }
  await rate.store.delete(rate.key).catch(() => {});
  return json({ authenticated: true }, 200, { 'Set-Cookie': adminSessionCookie(createAdminSession()) });
};
export const config = { path: '/api/admin/auth' };
