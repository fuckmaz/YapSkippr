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
  optional_host_permissions?: string[];
  optional_permissions?: string[];
  browser_specific_settings?: {
    gecko_android?: {
      strict_min_version?: string;
    };
    gecko?: {
      id?: string;
      strict_min_version?: string;
      data_collection_permissions?: {
        required?: string[];
        optional?: string[];
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
  expect(manifest.permissions).toContain('alarms');
  expect(manifest.host_permissions).not.toContain('<all_urls>');
  expect(manifest.host_permissions).toContain('https://www.youtube.com/*');
  expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
  expect(manifest.browser_specific_settings).toBeUndefined();
  expectYouTubeContentScript(manifest);
  await expectBuiltScripts('.output/chrome-mv3');
  await expectResponsivePopupStyles('.output/chrome-mv3');
});

test('Firefox build output declares Gecko metadata and keeps feature parity', async () => {
  const manifest = await readManifest('.output/firefox-mv2');

  expect(manifest.manifest_version).toBe(2);
  expect(manifest.name).toBe('YapSkippr');
  expect(manifest.description).toBe('In-Video Sponsorship- and Ad-Skipper');
  expect(manifest.permissions).toContain('activeTab');
  expect(manifest.permissions).toContain('alarms');
  expect(manifest.permissions).not.toContain('<all_urls>');
  expect(manifest.permissions).toContain('https://www.youtube.com/*');
  expect(manifest.optional_permissions).toEqual(['<all_urls>']);
  expect(manifest.browser_specific_settings?.gecko?.id).toBe('yapskippr@maz.dev');
  expect(manifest.browser_specific_settings?.gecko?.strict_min_version).toBe('140.0');
  expect(manifest.browser_specific_settings?.gecko_android?.strict_min_version).toBe('142.0');
  expect(manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required).toEqual(['none']);
  expect(manifest.browser_specific_settings?.gecko?.data_collection_permissions?.optional).toEqual([
    'personallyIdentifyingInfo',
    'browsingActivity',
    'websiteContent',
    'technicalAndInteraction'
  ]);
  expectYouTubeContentScript(manifest);
  await expectBuiltScripts('.output/firefox-mv2');
  await expectResponsivePopupStyles('.output/firefox-mv2');
});

test('installable archives contain browser extension payloads, not source bundles', async () => {
  const chromeManifest = await readZipJson<ExtensionManifest>('.output/installable/yapskippr-chrome.zip', 'manifest.json');
  const firefoxManifest = await readZipJson<ExtensionManifest>('.output/installable/yapskippr-firefox.zip', 'manifest.json');
  const firefoxXpiManifest = await readZipJson<ExtensionManifest>('.output/installable/yapskippr-firefox.xpi', 'manifest.json');
  const chromeZipEntries = new Set((await readZipEntries('.output/installable/yapskippr-chrome.zip')).map((entry) => entry.name));
  const firefoxZipEntries = new Set((await readZipEntries('.output/installable/yapskippr-firefox.zip')).map((entry) => entry.name));

  expect(chromeManifest.manifest_version).toBe(3);
  expect(chromeManifest.host_permissions).not.toContain('<all_urls>');
  expect(chromeManifest.optional_host_permissions).toEqual(['<all_urls>']);
  expect(firefoxManifest.manifest_version).toBe(2);
  expect(firefoxManifest.permissions).not.toContain('<all_urls>');
  expect(firefoxManifest.optional_permissions).toEqual(['<all_urls>']);
  expect(firefoxManifest.browser_specific_settings?.gecko?.strict_min_version).toBe('140.0');
  expect(firefoxManifest.browser_specific_settings?.gecko_android?.strict_min_version).toBe('142.0');
  expect(firefoxManifest.browser_specific_settings?.gecko?.data_collection_permissions).toEqual({
    required: ['none'],
    optional: [
      'personallyIdentifyingInfo',
      'browsingActivity',
      'websiteContent',
      'technicalAndInteraction'
    ]
  });
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
  expect(contentScript).toContain('YAPSKIPPR_CLAIM_SCAN_STATUS');
  expect(contentScript).toContain('YAPSKIPPR_UPDATE_SCAN_STATUS');
  expect(contentScript).toContain('YAPSKIPPR_GET_SCAN_CAPABILITY');
  expect(contentScript).toContain('YAPSKIPPR_GET_MISSED_SEGMENT_CONTEXT');
  expect(contentScript).toContain('scan status persistence disabled');
  expect(contentScript).toContain('frame-progress-bar');
  expect(contentScript).toContain('frame-qr-code');
  expect(contentScript).toContain('frame-visible-link');
  expect(contentScript).toContain('yapskippr.transcriptPhraseGroups');
  expect(contentScript).toContain('yapskippr.autoSkipEnabled');
  expect(contentScript).toContain('Auto-skipped detected ad read');
  expect(contentScript).toContain('Auto-skip undone');
  expect(contentScript).toContain('Auto-skip uses the configured detector score and requires a detected ending.');
  expect(contentScript).toContain('Visual checks returned to the standard 5s interval.');
  expect(contentScript).toContain('Visual checks are unavailable; caption-based detection continues.');
  expect(contentScript).not.toContain('Frame capture unavailable; transcript scan continues.');
  expect(contentScript).not.toContain('Fast pre-scan');
  expect(contentScript).toContain('aria-live');
  expect(contentScript).toContain('aria-atomic');
  expect(contentScript).not.toContain('.innerHTML=');

  const backgroundScript = await readFile(join(process.cwd(), outputPath, 'background.js'), 'utf8');
  expect(backgroundScript).toContain('setBadgeText');
  expect(backgroundScript).toContain('setBadgeBackgroundColor');
  expect(backgroundScript).toContain('yapskippr.scanStatus');
  expect(backgroundScript).toContain('yapskippr.scanOwner');
  expect(backgroundScript).toContain('YAPSKIPPR_CLAIM_SCAN_STATUS');
  expect(backgroundScript).toContain('YAPSKIPPR_UPDATE_SCAN_STATUS');
  expect(backgroundScript).toContain('storage.session');
  expect(backgroundScript).toContain('alarms.create');
  expect(backgroundScript).toContain('alarms.onAlarm');
  expect(backgroundScript).not.toContain('setInterval');
  expect(backgroundScript).toMatch(/setBadgeText\(\{tabId:/);
  expect(backgroundScript).toMatch(/setBadgeBackgroundColor\(\{tabId:/);
  expect(backgroundScript).toMatch(/setTitle\(\{tabId:/);

  const popupHtml = await readFile(join(process.cwd(), outputPath, 'popup.html'), 'utf8');
  expect(popupHtml).toContain('Allow on all websites');
  expect(popupHtml).toContain('requests access on all websites');
  expect(popupHtml).toContain('Detection status');
  expect(popupHtml).toContain('Open a YouTube video to find ad reads.');
  expect(popupHtml).toContain('Visual check interval');
  expect(popupHtml).toMatch(/id="fast-scan-toggle"[^>]*disabled/);
  expect(popupHtml).toContain('Detection signals');
  expect(popupHtml).toContain('Progress bar');
  expect(popupHtml).toContain('Auto-skip');
  expect(popupHtml).toContain('Skips only detected ad reads that include a detected ending.');
  expect(popupHtml).toContain('Missed an ad read?');
  expect(popupHtml).toContain('Report the missed segment to help improve future detection.');
  expect(popupHtml).toMatch(/id="auto-skip-toggle"[^>]*aria-pressed="false"[^>]*disabled/);
  expect(popupHtml).toContain('Advanced');
  expect(popupHtml).toContain('Share feedback');
  expect(popupHtml).toMatch(/id="feedback-consent"[^>]*disabled/);
  expect(popupHtml).toContain('Off by default');
  expect(popupHtml).toContain('stable anonymous ID');
  expect(popupHtml).toContain('nearby transcript text');
  expect(popupHtml).toContain('Feedback API endpoint');
  expect(popupHtml).toContain('Save requests access only to this endpoint origin');
  expect(popupHtml).toMatch(/id="fast-scan-status"[^>]*aria-live="polite"/);
  expect(popupHtml).toMatch(/id="permission-status"[^>]*aria-live="polite"/);
  expect(popupHtml).toContain('Open admin dashboard');
  expect(popupHtml).toContain('Transcript phrase groups');
  expect(popupHtml).toContain('Recent activity');
  expect(popupHtml).not.toContain('Fast pre-scan');
  expect(popupHtml).not.toContain('Teach YapSkippr');
  expect(popupHtml).not.toContain('High-confidence segments');
  expect(popupHtml).not.toContain('button below');
  expect(popupHtml).not.toContain('Frame analysis');

  const chunkFiles = await readdir(join(process.cwd(), outputPath, 'chunks'));
  const popupChunk = chunkFiles.find((file) => file.startsWith('popup-') && file.endsWith('.js'));
  expect(popupChunk).toBeTruthy();

  const popupScript = await readFile(join(process.cwd(), outputPath, 'chunks', popupChunk ?? ''), 'utf8');
  expect(Buffer.byteLength(popupScript, 'utf8')).toBeLessThan(100_000);
  expect(popupScript).toContain('permissions.request');
  expect(popupScript).toContain('Firefox permission removal failed');
  expect(popupScript).toContain('<all_urls>');
  expect(popupScript).toContain('yapskippr.scanStatus');
  expect(popupScript).toContain('storage.session');
  expect(popupScript).toContain('storage.onChanged');
  expect(popupScript).toContain('popup has no active tab ownership');
  expect(popupScript).toContain('tabs.sendMessage');
  expect(popupScript).toContain('YAPSKIPPR_SEEK_TO');
  expect(popupScript).toContain('YAPSKIPPR_SET_FAST_SCAN');
  expect(popupScript).toContain('YAPSKIPPR_GET_SCAN_CAPABILITY');
  expect(popupScript).toContain('YAPSKIPPR_GET_MISSED_SEGMENT_CONTEXT');
  expect(popupScript).toContain('yapskippr.feedbackEndpoint');
  expect(popupScript).toContain('yapskippr.feedbackConsent');
  expect(popupScript).toContain('yapskippr.clientId');
  expect(popupScript).toContain('AbortController');
  expect(popupScript).toContain('signal:');
  expect(popupScript).toContain('data_collection');
  expect(popupScript).toContain('personallyIdentifyingInfo');
  expect(popupScript).toContain('client_');
  expect(popupScript).toContain('missed_context');
  expect(popupScript).toContain('yapskippr.transcriptPhraseGroups');
  expect(popupScript).toContain('yapskippr.autoSkipEnabled');
  expect(popupScript).toContain('Open a YouTube video to use YapSkippr.');
  expect(popupScript).toContain('Access was not granted. Visual checks remain off');
  expect(popupScript).toContain('Undo is available beside the YouTube player after every skip.');
  expect(popupScript).toContain('Feedback endpoint saved with origin access. Sharing follows the switch above.');
  expect(popupScript).toContain('Transcript phrase groups saved');
  expect(popupScript).not.toContain('Frame capture unavailable; transcript scan continues.');
}

async function expectResponsivePopupStyles(outputPath: string): Promise<void> {
  const assetFiles = await readdir(join(process.cwd(), outputPath, 'assets'));
  const popupStylesheet = assetFiles.find((file) => file.startsWith('popup-') && file.endsWith('.css'));
  expect(popupStylesheet).toBeTruthy();

  const popupCss = await readFile(join(process.cwd(), outputPath, 'assets', popupStylesheet ?? ''), 'utf8');
  expect(popupCss).toMatch(/body\{[^}]*width:390px;min-width:0;max-width:390px;[^}]*overflow-x:hidden/);
  expect(popupCss).toMatch(/@media ?\((?:max-width:390px|width<=390px)\)\{body\{width:100%;max-width:100vw\}\}/);
  expect(popupCss).toMatch(/@media ?\((?:max-width:360px|width<=360px)\)\{main\{padding:var\(--space-3\)\}/);
  expect(popupCss).toMatch(/\.permission-panel\{grid-template-columns:minmax\(0,1fr\)\}/);
  expect(popupCss).not.toContain('radial-gradient');
  expect(popupCss).not.toContain('linear-gradient');
  expect(popupCss).not.toMatch(/@keyframes|animation:/);
}
