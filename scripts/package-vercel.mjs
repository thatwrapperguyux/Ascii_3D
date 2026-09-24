// Packages the production build as a zip for Vercel Drop (vercel.com/drop) or the
// Vercel CLI: the built files sit at the zip root next to a vercel.json without build
// settings, so Vercel serves them as-is (no install, no build step).
//
// Usage: npm run package:vercel  → ascii-3d-studio-vercel.zip
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const output = join(root, 'ascii-3d-studio-vercel.zip');

function listFiles(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
}

let files;
try {
  files = listFiles(dist);
} catch {
  console.error('dist/ not found. Run `npm run build` first (or use `npm run package:vercel`).');
  process.exit(1);
}
if (files.some((file) => file.endsWith(`${sep}vercel.json`))) {
  console.error('dist/ already contains a vercel.json; refusing to guess which one to ship.');
  process.exit(1);
}

// Keep the headers (caching, CORS for /models) and drop the build settings:
// the zip already is the build output.
const projectConfig = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const staticConfig = { $schema: projectConfig.$schema, headers: projectConfig.headers };

const entries = [
  ...files.map((file) => ({ name: relative(dist, file).split(sep).join('/'), data: readFileSync(file) })),
  { name: 'vercel.json', data: Buffer.from(`${JSON.stringify(staticConfig, null, 2)}\n`) },
];

// A minimal ZIP writer (stored or deflated entries, UTF-8 names, no ZIP64).
const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
const UTF8_NAMES = 0x0800;
const MADE_BY_UNIX = (3 << 8) | 20;
const FILE_MODE = (0o100644 << 16) >>> 0;

const localParts = [];
const centralParts = [];
let offset = 0;

for (const { name, data } of entries) {
  const nameBytes = Buffer.from(name, 'utf8');
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(UTF8_NAMES, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  localParts.push(local, nameBytes, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(MADE_BY_UNIX, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(UTF8_NAMES, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(FILE_MODE, 38);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, nameBytes);

  offset += local.length + nameBytes.length + body.length;
}

const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...localParts, ...centralParts, end]);
writeFileSync(output, zip);
console.log(`Wrote ${relative(root, output)} (${entries.length} files, ${(zip.length / 1024).toFixed(0)} KB).`);
console.log('Deploy it: drag the zip onto https://vercel.com/drop');
