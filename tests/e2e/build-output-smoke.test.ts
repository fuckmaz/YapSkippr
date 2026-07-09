import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

interface ExtensionManifest {
  manifest_version?: number;
  name?: string;
  description?: string;
  host_permissions?: string[];
  permissions?: string[];
  browser_specific_settings?: {
    gecko?: {
      id?: string;
      data_collection_permissions?: {
        required?: string[];
      };
    };
  };
  content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
}

interface ZipEntry {
  compressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  name: string;
}

test('Chrome build output contains the YouTube content script and preserved metadata', async () => {
  const manifest = await readManifest('.output/chrome-mv3');

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.name).toBe('YapSkippr');
  expect(manifest.description).toBe('In-Video Sponsorship- and Ad-Skipper');
  expect(manifest.permissions).toContain('activeTab');
  expect(manifest.host_permissions).toContain('<all_urls>');
  expect(manifest.browser_specific_settings).toBeUndefined();
  expectYouTubeContentScript(manifest);
  await expectBuiltScripts('.output/chrome-mv3');
});

test('Firefox build output declares Gecko metadata and keeps feature parity', async () => {
  const manifest = await readManifest('.output/firefox-mv2');

  expect(manifest.manifest_version).toBe(2);
  expect(manifest.name).toBe('YapSkippr');
  expect(manifest.description).toBe('In-Video Sponsorship- and Ad-Skipper');
  expect(manifest.permissions).toContain('activeTab');
  expect(manifest.permissions).toContain('<all_urls>');
  expect(manifest.browser_specific_settings?.gecko?.id).toBe('yapskippr@maz.dev');
  expect(manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required).toEqual(['none']);
  expectYouTubeContentScript(manifest);
  await expectBuiltScripts('.output/firefox-mv2');
});

test('installable archives contain browser extension payloads, not source bundles', async () => {
  const chromeManifest = await readZipJson<ExtensionManifest>('.output/installable/yapskippr-chrome.zip', 'manifest.json');
  const firefoxManifest = await readZipJson<ExtensionManifest>('.output/installable/yapskippr-firefox.zip', 'manifest.json');
  const firefoxXpiManifest = await readZipJson<ExtensionManifest>('.output/installable/yapskippr-firefox.xpi', 'manifest.json');
  const chromeZipEntries = new Set((await readZipEntries('.output/installable/yapskippr-chrome.zip')).map((entry) => entry.name));
  const firefoxZipEntries = new Set((await readZipEntries('.output/installable/yapskippr-firefox.zip')).map((entry) => entry.name));

  expect(chromeManifest.manifest_version).toBe(3);
  expect(firefoxManifest.manifest_version).toBe(2);
  expect(firefoxXpiManifest).toEqual(firefoxManifest);
  expect(chromeZipEntries.has('content-scripts/youtube.js')).toBe(true);
  expect(chromeZipEntries.has('popup.html')).toBe(true);
  expect(chromeZipEntries.has('package.json')).toBe(false);
  expect(chromeZipEntries.has('server/src/app.ts')).toBe(false);
  expect(firefoxZipEntries.has('content-scripts/youtube.js')).toBe(true);
  expect(firefoxZipEntries.has('popup.html')).toBe(true);
  expect(firefoxZipEntries.has('package.json')).toBe(false);
  expect(firefoxZipEntries.has('server/src/app.ts')).toBe(false);
});

async function readManifest(outputPath: string): Promise<ExtensionManifest> {
  const manifestPath = join(process.cwd(), outputPath, 'manifest.json');
  return JSON.parse(await readFile(manifestPath, 'utf8')) as ExtensionManifest;
}

async function readZipJson<T>(relativeArchivePath: string, entryPath: string): Promise<T> {
  return JSON.parse((await readZipText(relativeArchivePath, entryPath))) as T;
}

async function readZipText(relativeArchivePath: string, entryPath: string): Promise<string> {
  const archive = await readFile(join(process.cwd(), relativeArchivePath));
  const entry = readZipEntriesFromBuffer(archive).find((item) => item.name === entryPath);
  if (!entry) throw new Error(`${entryPath} not found in ${relativeArchivePath}`);

  const localOffset = entry.localHeaderOffset;
  if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error(`Invalid local file header for ${entryPath}`);
  }

  const fileNameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const compressed = archive.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed.toString('utf8');
  if (entry.compressionMethod === 8) return inflateRawSync(compressed).toString('utf8');
  throw new Error(`Unsupported zip compression method ${entry.compressionMethod} for ${entryPath}`);
}

async function readZipEntries(relativeArchivePath: string): Promise<ZipEntry[]> {
  return readZipEntriesFromBuffer(await readFile(join(process.cwd(), relativeArchivePath)));
}

function readZipEntriesFromBuffer(archive: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(archive);
  const totalEntries = archive.readUInt16LE(eocdOffset + 10);
  let offset = archive.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid zip central directory header.');
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    entries.push({ compressedSize, compressionMethod, localHeaderOffset, name });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumOffset = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Could not find zip end of central directory.');
}

function expectYouTubeContentScript(manifest: ExtensionManifest): void {
  expect(manifest.content_scripts?.[0]?.matches).toContain('https://youtube.com/*');
  expect(manifest.content_scripts?.[0]?.matches).toContain('https://*.youtube.com/*');
  expect(manifest.content_scripts?.[0]?.matches).toContain('https://www.youtube.com/*');
  expect(manifest.content_scripts?.[0]?.js?.[0]).toBe('content-scripts/youtube.js');
}

async function expectBuiltScripts(outputPath: string): Promise<void> {
  const contentScript = await readFile(join(process.cwd(), outputPath, 'content-scripts/youtube.js'), 'utf8');
  expect(contentScript).toContain('YAPSKIPPR_CAPTURE_VISIBLE_TAB');
  expect(contentScript).toContain('YAPSKIPPR_SEEK_TO');
  expect(contentScript).toContain('YAPSKIPPR_SET_FAST_SCAN');
  expect(contentScript).toContain('frame-progress-bar');
  expect(contentScript).toContain('frame-qr-code');
  expect(contentScript).toContain('frame-visible-link');
  expect(contentScript).toContain('yapskippr.transcriptPhraseGroups');

  const backgroundScript = await readFile(join(process.cwd(), outputPath, 'background.js'), 'utf8');
  expect(backgroundScript).toContain('setBadgeText');
  expect(backgroundScript).toContain('setBadgeBackgroundColor');
  expect(backgroundScript).toContain('yapskippr.scanStatus');

  const popupHtml = await readFile(join(process.cwd(), outputPath, 'popup.html'), 'utf8');
  expect(popupHtml).toContain('Grant frame capture access');
  expect(popupHtml).toContain('Current scan');
  expect(popupHtml).toContain('Fast pre-scan');
  expect(popupHtml).toContain('Evidence');
  expect(popupHtml).toContain('Detailed mode');
  expect(popupHtml).toContain('Feedback API endpoint');
  expect(popupHtml).toContain('Open admin dashboard');
  expect(popupHtml).toContain('Transcript phrase groups');
  expect(popupHtml).toContain('Recent activity');

  const chunkFiles = await readdir(join(process.cwd(), outputPath, 'chunks'));
  const popupChunk = chunkFiles.find((file) => file.startsWith('popup-') && file.endsWith('.js'));
  expect(popupChunk).toBeTruthy();

  const popupScript = await readFile(join(process.cwd(), outputPath, 'chunks', popupChunk ?? ''), 'utf8');
  expect(popupScript).toContain('permissions.request');
  expect(popupScript).toContain('<all_urls>');
  expect(popupScript).toContain('yapskippr.scanStatus');
  expect(popupScript).toContain('storage.onChanged');
  expect(popupScript).toContain('tabs.sendMessage');
  expect(popupScript).toContain('YAPSKIPPR_SEEK_TO');
  expect(popupScript).toContain('YAPSKIPPR_SET_FAST_SCAN');
  expect(popupScript).toContain('yapskippr.feedbackEndpoint');
  expect(popupScript).toContain('yapskippr.transcriptPhraseGroups');
  expect(popupScript).toContain('Feedback endpoint saved. Admin dashboard link ready.');
  expect(popupScript).toContain('Transcript phrase groups saved');
}
