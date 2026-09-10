export function clean(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

export function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders } });
}

export async function readBody(req) {
  const type = (req.headers.get('content-type') || '').toLowerCase();
  if (type.includes('application/json')) { const body = await req.json(); return body && typeof body === 'object' ? body : {}; }
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) { const form = await req.formData(); return Object.fromEntries(form.entries()); }
  throw new Error('Unsupported content type.');
}

export function clientIp(req) {
  const direct = clean(req.headers.get('x-nf-client-connection-ip'), 80);
  if (direct) return direct;
  return clean((req.headers.get('x-forwarded-for') || '').split(',')[0], 80) || 'unknown';
}
