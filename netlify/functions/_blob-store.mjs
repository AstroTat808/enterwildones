import { getDeployStore, getStore } from '@netlify/blobs';

export function blobStore(name, { strong = true } = {}) {
  const deployContext = globalThis.Netlify?.context?.deploy?.context || '';
  if (deployContext === 'production') return getStore(name, strong ? { consistency: 'strong' } : undefined);
  return getDeployStore(name);
}
