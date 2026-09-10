export function env(name, fallback = '') {
  const value = globalThis.Netlify?.env?.get?.(name);
  return value === undefined || value === null || value === '' ? fallback : String(value);
}
