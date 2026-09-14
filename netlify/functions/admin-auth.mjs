import { clearAdminCookie, createAdminSession, isAdmin, adminCookie, adminKeyMatches } from './_admin-auth.mjs';
import { blobStore } from './_blob-store.mjs';
import { clientIp, json, readBody } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { STORES, sha256 } from './_stores.mjs';
import { writeAudit } from './_audit.mjs';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

async function rate(req) {
  const store = blobStore(STORES.rateLimits);
  const ipHash = sha256(clientIp(req));
  const key = `admin-login/ip/${ipHash}`;
  const now = Date.now();
  const found = await store.get(key, { type: 'json' }).catch(() => null);
  const state = found && Number(found.windowStart) > now - WINDOW_MS ? found : { windowStart: now, failures: 0 };
  return { store, key, ipHash, state };
}

export default async (req) => {
  if (req.method === 'GET') return isAdmin(req) ? json({ authenticated: true }) : json({ authenticated: false }, 401);
  if (req.method === 'DELETE') {
    if (!sameOrigin(req)) return json({ error: 'Origin not allowed.' }, 403);
    if (isAdmin(req)) await writeAudit({ action: 'admin.logout', actor: 'admin', targetType: 'session', detail: { ipHash: sha256(clientIp(req)) } });
    return json({ ok: true }, 200, { 'Set-Cookie': clearAdminCookie() });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(req)) return json({ error: 'Origin not allowed.' }, 403);
  let body;
  try { body = await readBody(req); } catch { return json({ error: 'Invalid request.' }, 400); }
  let limiter;
  try { limiter = await rate(req); } catch { return json({ error: 'Admin login unavailable.' }, 503); }
  if (Number(limiter.state.failures) >= MAX_FAILURES) {
    await writeAudit({ action: 'admin.login_rate_limited', actor: 'anonymous', targetType: 'session', detail: { ipHash: limiter.ipHash } });
    return json({ error: 'Too many failed admin login attempts. Try again later.' }, 429, { 'Retry-After': '900' });
  }
  if (!adminKeyMatches(body.key || body.password || '')) {
    await limiter.store.setJSON(limiter.key, { windowStart: limiter.state.windowStart, failures: Number(limiter.state.failures || 0) + 1, updatedAt: new Date().toISOString() }).catch(() => {});
    await writeAudit({ action: 'admin.login_failed', actor: 'anonymous', targetType: 'session', detail: { ipHash: limiter.ipHash } });
    return json({ error: 'Invalid admin key.' }, 401);
  }
  await limiter.store.delete(limiter.key).catch(() => {});
  let token;
  try { token = createAdminSession(); } catch { return json({ error: 'Admin login unavailable.' }, 503); }
  await writeAudit({ action: 'admin.login_succeeded', actor: 'admin', targetType: 'session', detail: { ipHash: limiter.ipHash } });
  return json({ ok: true }, 200, { 'Set-Cookie': adminCookie(token) });
};

export const config = { path: '/api/admin/auth' };
