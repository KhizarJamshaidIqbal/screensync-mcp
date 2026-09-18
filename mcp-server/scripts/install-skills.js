#!/usr/bin/env node
// ScreenSync Skill Installer — auto-detect AI harnesses and deploy skills

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

// Skill source files
const SKILL_SOURCE = join(REPO_ROOT, '.agents', 'skills', 'screensync-operator', 'SKILL.md');
const SKILL_RELEASE_SOURCE = join(REPO_ROOT, '.agents', 'skills', 'screensync-release', 'SKILL.md');
const SKILL_LEARN_SOURCE = join(REPO_ROOT, '.agents', 'skills', 'screensync-learn', 'SKILL.md');

// Harness definitions
const HARNESSES = [
  {
    name: 'Cursor',
    detect: () => {
      const dir = join(homedir(), '.cursor');
      return existsSync(dir) ? dir : null;
    },
    install: (baseDir) => [
      { src: SKILL_SOURCE, dest: join(baseDir, 'skills', 'screensync-operator', 'SKILL.md') },
      { src: SKILL_LEARN_SOURCE, dest: join(baseDir, 'skills', 'screensync-learn', 'SKILL.md') }
    ]
  },
  {
    name: 'Claude Code',
    detect: () => {
      const dir = join(homedir(), '.claude');
      return existsSync(dir) ? dir : null;
    },
    install: (baseDir) => [
      { src: SKILL_SOURCE, dest: join(baseDir, 'commands', 'screensync-operator.md') },
      { src: SKILL_LEARN_SOURCE, dest: join(baseDir, 'commands', 'screensync-learn.md') }
    ]
  },
  {
    name: 'OpenAI Codex / Agents',
    detect: () => {
      // Check workspace-level .agents/ dir
      const dir = join(REPO_ROOT, '.agents', 'skills');
      return existsSync(dir) ? dirname(dirname(dir)) : null;
    },
    install: (baseDir) => [
      { src: SKILL_SOURCE, dest: join(baseDir, '.agents', 'skills', 'screensync-operator', 'SKILL.md') },
      { src: SKILL_LEARN_SOURCE, dest: join(baseDir, '.agents', 'skills', 'screensync-learn', 'SKILL.md') }
    ]
  },
  {
    name: 'OpenClaw',
    detect: () => {
      const dir = join(homedir(), '.openclaw-autoclaw');
      if (existsSync(dir)) return dir;
      const dir2 = join(homedir(), '.openclaw');
      return existsSync(dir2) ? dir2 : null;
    },
    install: (baseDir) => [
      { src: SKILL_SOURCE, dest: join(baseDir, 'skills', 'screensync-operator', 'SKILL.md') },
      { src: SKILL_LEARN_SOURCE, dest: join(baseDir, 'skills', 'screensync-learn', 'SKILL.md') }
    ]
  },
  {
    name: 'VS Code Copilot',
    detect: () => {
      const dir = join(homedir(), '.github');
      return existsSync(dir) ? dir : null;
    },
    install: (baseDir) => [
      { src: SKILL_SOURCE, dest: join(baseDir, 'copilot-instructions', 'screensync-operator.md') },
      { src: SKILL_LEARN_SOURCE, dest: join(baseDir, 'copilot-instructions', 'screensync-learn.md') }
    ]
  },
  {
    name: 'Antigravity / Gemini',
    detect: () => {
      const dir = join(homedir(), '.gemini');
      return existsSync(dir) ? dir : null;
    },
    install: (baseDir) => [
      { src: SKILL_SOURCE, dest: join(baseDir, 'config', 'skills', 'screensync-operator', 'SKILL.md') },
      { src: SKILL_LEARN_SOURCE, dest: join(baseDir, 'config', 'skills', 'screensync-learn', 'SKILL.md') }
    ]
  }
];

/**
 * Compute SHA-256 hex digest of file contents.
 * Returns null if file does not exist or cannot be read.
 */
function fileHash(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Print CLI usage guide.
 */
function printHelp() {
  console.log(`
ScreenSync Skill Installer
Auto-detect AI coding harnesses and deploy ScreenSync skill files.

Usage:
  node scripts/install-skills.js [options]

Options:
  --yes, -y       Auto-install to all detected harnesses without prompting
  --force, -f     Overwrite destination files even if hashes match
  --dry-run, -n   Simulate installation and report actions without writing files
  --help, -h      Show this help message
`);
}

/**
 * Prompt the user for input via readline.
 */
function askQuestion(promptText) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((res) => {
    rl.question(promptText, (answer) => {
      rl.close();
      res(answer.trim());
    });
  });
}

/**
 * Main installer routine.
 */
async function main() {
  const args = process.argv.slice(2);
  const isHelp = args.includes('--help') || args.includes('-h');
  const isYes = args.includes('--yes') || args.includes('-y');
  const isForce = args.includes('--force') || args.includes('-f');
  const isDryRun = args.includes('--dry-run') || args.includes('-n');

  if (isHelp) {
    printHelp();
    process.exit(0);
  }

  console.log('\n=== ScreenSync Skill Installer ===\n');

  // Step 2: Verify SKILL_SOURCE exists
  if (!existsSync(SKILL_SOURCE)) {
    console.error(`Error: Skill source file not found: ${SKILL_SOURCE}`);
    process.exit(1);
  }

  const sourceHash = fileHash(SKILL_SOURCE);
  console.log(`Source skill:  ${SKILL_SOURCE}`);
  console.log(`Source hash:   ${sourceHash ? sourceHash.slice(0, 12) + '...' : 'unknown'}`);
  if (isDryRun) {
    console.log('Mode:          DRY RUN (simulation only, no files modified)');
  }
  if (isForce) {
    console.log('Mode:          FORCE (overwriting even if hash matches)');
  }
  console.log('');

  // Step 3: Detect installed harnesses
  const detected = [];
  for (const harness of HARNESSES) {
    const baseDir = harness.detect();
    if (baseDir) {
      detected.push({ harness, baseDir });
    }
  }

  if (detected.length === 0) {
    console.log('No supported AI harnesses detected on this machine.');
    console.log('Supported harnesses: ' + HARNESSES.map((h) => h.name).join(', '));
    process.exit(0);
  }

  console.log(`Detected ${detected.length} AI harness(es):`);
  detected.forEach((item, index) => {
    console.log(`  [${index + 1}] ${item.harness.name}: ${item.baseDir}`);
  });
  console.log('');

  // Step 4: Prompt user interactively if not --yes
  let selected = [];
  if (isYes) {
    selected = detected;
  } else if (!process.stdin.isTTY) {
    console.log('Non-interactive terminal detected: proceeding with all detected harnesses.');
    selected = detected;
  } else {
    console.log('Select harnesses to install skills into:');
    console.log("  - Press Enter or type 'all' to install to all detected harnesses");
    console.log('  - Type comma-separated numbers (e.g. 1, 2) to select specific harnesses');
    console.log("  - Type 'q' to quit\n");

    const answer = await askQuestion('Selection [all]: ');

    if (answer.toLowerCase() === 'q' || answer.toLowerCase() === 'quit' || answer.toLowerCase() === 'exit') {
      console.log('Installation cancelled by user.');
      process.exit(0);
    }

    if (answer === '' || answer.toLowerCase() === 'all' || answer.toLowerCase() === 'a' || answer.toLowerCase() === 'y') {
      selected = detected;
    } else {
      const parts = answer.split(/[\s,]+/).map((s) => parseInt(s, 10));
      const indices = parts.filter((n) => !isNaN(n) && n >= 1 && n <= detected.length);

      if (indices.length === 0) {
        console.error('Invalid selection. Exiting.');
        process.exit(1);
      }

      const uniqueIndices = [...new Set(indices)];
      selected = uniqueIndices.map((i) => detected[i - 1]);
    }
  }

  console.log(`\nDeploying skills to ${selected.length} harness(es)...\n`);

  // Step 5: For each selected harness, install files
  const stats = { installed: 0, updated: 0, upToDate: 0, failed: 0 };

  for (const { harness, baseDir } of selected) {
    console.log(`[${harness.name}]`);
    const files = harness.install(baseDir);

    for (const file of files) {
      const { src, dest } = file;
      const normalizedSrc = resolve(src);
      const normalizedDest = resolve(dest);

      if (!existsSync(normalizedSrc)) {
        console.log(`  ✖ Source file missing: ${normalizedSrc}`);
        stats.failed++;
        continue;
      }

      // Check if source and destination point to the exact same file
      const isSamePath = process.platform === 'win32'
        ? normalizedSrc.toLowerCase() === normalizedDest.toLowerCase()
        : normalizedSrc === normalizedDest;

      if (isSamePath) {
        console.log(`  • Up to date (repo source location): ${normalizedDest}`);
        stats.upToDate++;
        continue;
      }

      const currentSrcHash = fileHash(normalizedSrc);
      const destExists = existsSync(normalizedDest);
      const currentDestHash = destExists ? fileHash(normalizedDest) : null;

      if (destExists && !isForce && currentSrcHash === currentDestHash) {
        console.log(`  ✔ Up to date: ${normalizedDest}`);
        stats.upToDate++;
        continue;
      }

      const actionLabel = !destExists ? 'Install' : 'Update';

      if (isDryRun) {
        console.log(`  * [DRY RUN] Would ${actionLabel.toLowerCase()}: ${normalizedDest}`);
        if (!destExists) stats.installed++;
        else stats.updated++;
        continue;
      }

      try {
        const destDir = dirname(normalizedDest);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        copyFileSync(normalizedSrc, normalizedDest);
        console.log(`  ✔ ${actionLabel}ed: ${normalizedDest}`);
        if (!destExists) stats.installed++;
        else stats.updated++;
      } catch (err) {
        console.error(`  ✖ Failed to write ${normalizedDest}: ${err.message}`);
        stats.failed++;
      }
    }
    console.log('');
  }

  // Step 6: Report results
  console.log('=== Installation Summary ===');
  console.log(`  Installed:    ${stats.installed}`);
  console.log(`  Updated:      ${stats.updated}`);
  console.log(`  Up to date:   ${stats.upToDate}`);
  if (stats.failed > 0) {
    console.log(`  Failed:       ${stats.failed}`);
  }
  console.log('');

  if (stats.failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
