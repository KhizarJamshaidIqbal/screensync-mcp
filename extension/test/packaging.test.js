import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';

function readZipEntryNames(zipFilePath) {
  const buf = fs.readFileSync(zipFilePath);
  const entries = [];
  let pos = 0;
  // Look for Central Directory headers (PK\x01\x02 -> 0x02014b50)
  while (pos < buf.length - 4) {
    if (buf[pos] === 0x50 && buf[pos + 1] === 0x4b && buf[pos + 2] === 0x01 && buf[pos + 3] === 0x02) {
      const fileNameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const name = buf.toString('utf8', pos + 46, pos + 46 + fileNameLen);
      entries.push(name);
      pos += 46 + fileNameLen + extraLen + commentLen;
    } else {
      pos++;
    }
  }
  return entries;
}

test('screensync-extension.zip has valid structure and 0 backslashes (D10)', () => {
  const zipPath = path.resolve('website/downloads/screensync-extension.zip');
  assert.ok(fs.existsSync(zipPath), 'website/downloads/screensync-extension.zip must exist');

  const entries = readZipEntryNames(zipPath);
  console.log('[test-packaging] extension zip entry count:', entries.length);

  assert.ok(entries.length > 30, 'Extension zip should contain all extension assets');
  assert.ok(entries.includes('manifest.json'), 'Extension zip must contain manifest.json in root');

  const backslashEntries = entries.filter((e) => e.includes('\\'));
  assert.strictEqual(
    backslashEntries.length,
    0,
    `ZIP entries must use forward slash '/' (APPNOTE §4.4.17). Found backslash in: ${backslashEntries.join(', ')}`,
  );
});

test('screensync-hub.zip has launchers, lockfile, and no test artifacts (D11)', () => {
  const zipPath = path.resolve('website/downloads/screensync-hub.zip');
  assert.ok(fs.existsSync(zipPath), 'website/downloads/screensync-hub.zip must exist');

  const entries = readZipEntryNames(zipPath);
  console.log('[test-packaging] hub zip entry count:', entries.length);

  assert.ok(entries.includes('start-hub.bat'), 'Hub zip must contain start-hub.bat');
  assert.ok(entries.includes('start-hub.sh'), 'Hub zip must contain start-hub.sh');
  assert.ok(entries.includes('package-lock.json'), 'Hub zip must contain package-lock.json');
  assert.ok(entries.includes('README.md'), 'Hub zip must contain README.md');
  assert.ok(entries.includes('dist/index.js'), 'Hub zip must contain dist/index.js');

  const testEntries = entries.filter((e) => e.startsWith('dist/test/'));
  assert.strictEqual(testEntries.length, 0, 'Hub zip must exclude dist/test/ artifacts');

  const backslashEntries = entries.filter((e) => e.includes('\\'));
  assert.strictEqual(backslashEntries.length, 0, 'Hub zip entries must not contain backslashes');
});

