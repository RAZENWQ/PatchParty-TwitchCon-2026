import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createZip, inspectZipEntries, validateEntryName } from '../scripts/build-submission.mjs';

test('submission ZIP is generated from safe tracked filenames and can be inspected', async () => {
  execFileSync(process.execPath, ['scripts/build-submission.mjs'], { cwd: process.cwd(), stdio: 'pipe' });
  const archive = await readFile('dist/patchparty-source.zip');
  const centralOffset = archive.indexOf(Buffer.from('PK\x01\x02', 'binary'));
  assert.ok(centralOffset > 0);
  const entries = inspectZipEntries(archive.subarray(centralOffset));
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(entries.includes('README.md'));
  assert.ok(entries.includes('src/twitch.mjs'));
  assert.ok(entries.every(name => tracked.includes(name)));
  assert.ok(entries.every(name => !/(^|\/)\.env|\.log$|\.jsonl$|(^|\/)dist\//i.test(name)));
  assert.deepEqual(entries, [...entries].sort((a, b) => a.localeCompare(b, 'en')));
});

test('ZIP builder rejects traversal and sensitive filenames', () => {
  for (const name of ['../secret.txt', '/absolute.txt', 'folder\\file.txt', '.env', 'video/demo.mp4'])
    assert.throws(() => validateEntryName(name));
  const zip = createZip([{ name: 'safe.txt', data: Buffer.from('safe') }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
});
