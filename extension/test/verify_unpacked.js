import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate extension.zip
const possibleZipPaths = [
  path.resolve(__dirname, '../extension.zip'),
  path.resolve(__dirname, '../../extension/extension.zip'),
  path.resolve(__dirname, '../../website/downloads/screensync-extension.zip'),
  path.resolve(process.cwd(), 'extension/extension.zip'),
  path.resolve(process.cwd(), 'website/downloads/screensync-extension.zip')
];

let zipPath = null;
for (const p of possibleZipPaths) {
  if (fs.existsSync(p)) {
    zipPath = p;
    break;
  }
}

if (!zipPath) {
  console.error('[verify_unpacked] Error: extension.zip not found. Run scripts/package.ps1 first.');
  process.exit(1);
}

const tempDir = path.join(os.tmpdir(), 'screensync-verify-unpacked-' + Date.now());
fs.mkdirSync(tempDir, { recursive: true });

console.log('[verify_unpacked] Testing packaged artifact:', zipPath);
console.log('[verify_unpacked] Extracting to temporary directory:', tempDir);

try {
  // Unzip using system tool
  if (process.platform === 'win32') {
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force"`, { stdio: 'pipe' });
  } else {
    execSync(`unzip -q "${zipPath}" -d "${tempDir}"`, { stdio: 'pipe' });
  }

  // 1. Verify manifest
  const manifestPath = path.join(tempDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('manifest.json missing in extracted package');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`[verify_unpacked] Manifest: ${manifest.name} v${manifest.version} (min_chrome: ${manifest.minimum_chrome_version})`);
  if (!manifest.version || !manifest.minimum_chrome_version) {
    throw new Error('Manifest missing version or minimum_chrome_version');
  }

  // 2. Syntax check all JS files
  function collectJs(dir) {
    let results = [];
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) {
        results = results.concat(collectJs(full));
      } else if (full.endsWith('.js')) {
        results.push(full);
      }
    }
    return results;
  }

  const jsFiles = collectJs(tempDir);
  console.log(`[verify_unpacked] Syntax-checking ${jsFiles.length} extracted JS files with node --check...`);
  for (const js of jsFiles) {
    execSync(`node --check "${js}"`, { stdio: 'pipe' });
  }
  console.log('[verify_unpacked] Syntax check: 0 errors across all JS files.');

  // 3. Verify module resolution in background.js and lib/web-tools.js
  function verifyImports(filePath, baseDir) {
    const code = fs.readFileSync(filePath, 'utf8');
    const importRegex = /import\s+.*?from\s+['"](.*?)['"]/g;
    let match;
    let count = 0;
    while ((match = importRegex.exec(code)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('.')) {
        const resolved = path.resolve(baseDir, importPath);
        if (!fs.existsSync(resolved)) {
          throw new Error(`Missing import in ${filePath}: ${importPath} -> ${resolved}`);
        }
        count++;
      }
    }
    return count;
  }

  const bgImports = verifyImports(path.join(tempDir, 'background.js'), tempDir);
  console.log(`[verify_unpacked] background.js: ${bgImports} imports resolved successfully.`);

  const wtImports = verifyImports(path.join(tempDir, 'lib/web-tools.js'), path.join(tempDir, 'lib'));
  console.log(`[verify_unpacked] lib/web-tools.js: ${wtImports} imports resolved successfully.`);

  // 4. Verify bundled font
  const fontPath = path.join(tempDir, 'fonts/plus-jakarta-sans.woff2');
  if (!fs.existsSync(fontPath)) {
    throw new Error('Bundled font fonts/plus-jakarta-sans.woff2 missing from package');
  }
  const fontStat = fs.statSync(fontPath);
  if (fontStat.size < 10000) {
    throw new Error(`Bundled font is suspiciously small: ${fontStat.size} bytes`);
  }
  console.log(`[verify_unpacked] Bundled font verified: fonts/plus-jakarta-sans.woff2 (${fontStat.size} bytes).`);

  console.log('[verify_unpacked] SUCCESS: Packaged extension passes all static load and module resolution checks.');
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('[verify_unpacked] Cleaned up temporary directory.');
  } catch (err) {
    console.warn('[verify_unpacked] Warning: Failed to clean up temp dir:', err.message);
  }
}
