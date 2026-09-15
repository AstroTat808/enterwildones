import { copyFile, mkdir, stat } from 'node:fs/promises';
// Fail the build before publication if any approved campaign asset is absent or altered.
import './validate-campaign.mjs';

const vendorDir = new URL('../site/assets/vendor/', import.meta.url);
const source = new URL('../node_modules/html5-qrcode/html5-qrcode.min.js', import.meta.url);
const target = new URL('html5-qrcode.min.js', vendorDir);

await mkdir(vendorDir, { recursive: true });
await copyFile(source, target);

const info = await stat(target);
if (!info.isFile() || info.size < 10000) {
  throw new Error('html5-qrcode browser bundle was not copied correctly.');
}

console.log(`Prepared html5-qrcode browser bundle (${info.size} bytes).`);
