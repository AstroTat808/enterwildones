import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './_env.mjs';
import { dispatchFailureAlert, updateDeliveryEvent } from './_email-service.mjs';

function validSignature(raw, req) {
  const secret = env('WILDONES_RESEND_WEBHOOK_SECRET');
  if (!secret || !secret.startsWith('whsec_')) return false;
  const id = req.headers.get('svix-id') || '';
  const timestamp = req.headers.get('svix-timestamp') || '';
  const signatures = (req.headers.get('svix-signature') || '').trim().split(/\s+/);
  const time = Number(timestamp);
  if (!id || !/^\d+$/.test(timestamp) || !Number.isFinite(time) ||
      Math.abs(Date.now() / 1000 - time) > 300 || !signatures.length) return false;
  let key;
  try { key = Buffer.from(secret.slice(6), 'base64'); } catch { return false; }
  if (!key.length) return false;
  const digest = createHmac('sha256', key).update(id + '.' + timestamp + '.' + raw).digest();
  return signatures.some((candidate) => {
    if (!candidate.startsWith('v1,')) return false;
    const supplied = Buffer.from(candidate.slice(3), 'base64');
    return supplied.length === digest.length && timingSafeEqual(supplied, digest);
  });
}
export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (Number(req.headers.get('content-length') || 0) > 131072) return new Response('Payload too large', { status: 413 });
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 131072) return new Response('Payload too large', { status: 413 });
  if (!validSignature(raw, req)) return new Response('Unauthorized', { status: 401 });
  let payload;
  try { payload = JSON.parse(raw); } catch { return new Response('Invalid payload', { status: 400 }); }
  try {
    const result = await updateDeliveryEvent(payload);
    if (result.shouldAlert && result.record) {
      const providerId = String(payload.data?.email_id || '');
      await dispatchFailureAlert({ type: payload.type, record: result.record, providerId }).catch((error) => {
        console.error('Resend alert submission failed:', String(error?.message || error).slice(0, 120));
      });
    }
    return new Response('ok', { status: 200 });
  } catch (error) {
    console.error('Resend webhook failed:', String(error?.message || error).slice(0, 120));
    return new Response('Retry later', { status: 503 });
  }
};
export const config = { path: '/api/webhooks/resend' };
