export function env(name, fallback = '') {
  const netlifyValue = globalThis.Netlify?.env?.get?.(name);
  const processValue = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const value = netlifyValue ?? processValue;
  return value === undefined || value === null || value === '' ? fallback : String(value);
}
