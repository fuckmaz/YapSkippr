#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(rootDir, '.output');
const installableDir = join(outputDir, 'installable');

runNpmScript('build');
runNpmScript('zip');
const chromeZip = newestZip();

runNpmScript('build:firefox');
runNpmScript('zip:firefox');
const firefoxZip = newestZip(new Set([chromeZip]));

rmSync(installableDir, { force: true, recursive: true });
mkdirSync(installableDir, { recursive: true });

const chromeInstallZip = join(installableDir, 'yapskippr-chrome.zip');
const firefoxInstallZip = join(installableDir, 'yapskippr-firefox.zip');
const firefoxInstallXpi = join(installableDir, 'yapskippr-firefox.xpi');

copyFileSync(chromeZip, chromeInstallZip);
copyFileSync(firefoxZip, firefoxInstallZip);
copyFileSync(firefoxZip, firefoxInstallXpi);

printInstallSummary({
  chromeUnpacked: join(outputDir, 'chrome-mv3'),
  chromeZip: chromeInstallZip,
  firefoxUnpacked: join(outputDir, 'firefox-mv2'),
  firefoxZip: firefoxInstallZip,
  firefoxXpi: firefoxInstallXpi
});

function runNpmScript(scriptName) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCommand, ['run', scriptName], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function newestZip(exclude = new Set()) {
  const zips = findFiles(outputDir, (path) => path.endsWith('.zip') && !path.includes(`${installableDir}/`) && !exclude.has(path));
  const newest = zips.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!newest) {
    throw new Error('WXT did not produce a zip file.');
  }
  return newest;
}

function findFiles(dir, predicate) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findFiles(path, predicate);
    return predicate(path) ? [path] : [];
  });
}

function printInstallSummary(paths) {
  const rel = (path) => relative(rootDir, path);

  console.log('\nYapSkippr installable artifacts are ready:\n');
  console.log('Chrome / Chromium local install:');
  console.log(`  1. Open chrome://extensions`);
  console.log('  2. Enable Developer mode');
  console.log(`  3. Click "Load unpacked" and select: ${rel(paths.chromeUnpacked)}`);
  console.log(`  Store/upload zip: ${rel(paths.chromeZip)}\n`);
  console.log('Firefox local install:');
  console.log('  1. Open about:debugging#/runtime/this-firefox');
  console.log('  2. Click "Load Temporary Add-on..."');
  console.log(`  3. Select: ${rel(join(paths.firefoxUnpacked, 'manifest.json'))}`);
  console.log(`  XPI-style archive: ${rel(paths.firefoxXpi)}`);
  console.log(`  ZIP archive: ${rel(paths.firefoxZip)}\n`);
}
