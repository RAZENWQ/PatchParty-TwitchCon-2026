import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(projectDir, 'dist', 'patchparty-source.zip');
const blocked = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)\.git(?:\/|$)/i,
  /(^|\/)dist(?:\/|$)/i,
  /(^|\/)(?:node_modules|coverage|test-profile|tmp|temp)(?:\/|$)/i,
  /(?:^|\/)(?:secrets?|credentials?)(?:[.\/]|$)/i,
  /\.(?:log|jsonl|mp4|mov|avi|mkv|webm)$/i,
  /(?:^|\/)patchparty-preview\.png$/i
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validateEntryName(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.includes('\0'))
    throw new Error('Unsafe archive filename');
  const normalized = posix.normalize(name);
  if (normalized !== name || normalized === '..' || normalized.startsWith('../')) throw new Error('Unsafe archive filename');
  if (blocked.some(pattern => pattern.test(name))) throw new Error('Sensitive or generated file refused: ' + name);
  return name;
}

function trackedFiles() {
  const raw = execFileSync('git', ['ls-files', '-z'], { cwd: projectDir, encoding: 'utf8' });
  return raw.split('\0').filter(Boolean).sort((a, b) => a.localeCompare(b, 'en'));
}

export function createZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(validateEntryName(entry.name), 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(0x5c21, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8); record.writeUInt16LE(0, 10); record.writeUInt16LE(0, 12); record.writeUInt16LE(0x5c21, 14);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

export function inspectZipEntries(buffer) {
  const names = [];
  let offset = 0;
  while (offset + 46 <= buffer.length && buffer.readUInt32LE(offset) === 0x02014b50) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

export function buildSubmission() {
  const names = trackedFiles().filter(name => !blocked.some(pattern => pattern.test(name)));
  if (!names.length) throw new Error('No eligible tracked files found');
  const entries = names.map(name => {
    validateEntryName(name);
    const path = join(projectDir, ...name.split('/'));
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Archive input must be a regular file: ' + name);
    return { name, data: readFileSync(path) };
  });
  const archive = createZip(entries);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, archive);
  const inspected = inspectZipEntries(archive.subarray(archive.indexOf(Buffer.from('PK\x01\x02', 'binary'))));
  if (inspected.length !== entries.length || inspected.some((name, index) => name !== entries[index].name))
    throw new Error('Archive verification failed');
  return { outputPath, names: inspected, bytes: archive.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildSubmission();
  console.log(`Created dist/${result.outputPath.split(/[\\/]/).at(-1)} with ${result.names.length} tracked source files (${result.bytes} bytes).`);
}
