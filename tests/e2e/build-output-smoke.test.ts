import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

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

async function readManifest(outputPath: string): Promise<ExtensionManifest> {
  const manifestPath = join(process.cwd(), outputPath, 'manifest.json');
  return JSON.parse(await readFile(manifestPath, 'utf8')) as ExtensionManifest;
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
