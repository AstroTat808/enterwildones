import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './_env.mjs';

function safeEqual(a = '', b = '') { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }
export function stripeConfigured() { return Boolean(env('STRIPE_SECRET_KEY') && env('STRIPE_WEBHOOK_SECRET')); }
export async function stripePost(path, body, idempotencyKey = '') {
  const secret = env('STRIPE_SECRET_KEY');
  if (!secret) throw new Error('Stripe is not configured.');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body: new URLSearchParams(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Stripe returned ${response.status}.`);
  return data;
}
export async function stripeGet(path) {
  const secret = env('STRIPE_SECRET_KEY');
  if (!secret) throw new Error('Stripe is not configured.');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${secret}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Stripe returned ${response.status}.`);
  return data;
}
export function verifyStripeSignature(rawBody, header, nowSeconds = Math.floor(Date.now() / 1000)) {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret) return false;
  const parts = String(header || '').split(',').map((x) => x.trim());
  const timestamp = parts.find((x) => x.startsWith('t='))?.slice(2) || '';
  const signatures = parts.filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  if (!/^\d{9,12}$/.test(timestamp) || !signatures.length || Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return signatures.some((sig) => safeEqual(sig, expected));
}
