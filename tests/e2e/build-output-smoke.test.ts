import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

test('Chrome build output contains the YouTube content script and preserved metadata', async () => {
  const manifestPath = join(process.cwd(), '.output/chrome-mv3/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    name?: string;
    description?: string;
    host_permissions?: string[];
    permissions?: string[];
    content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
  };

  expect(manifest.name).toBe('YapSkippr');
  expect(manifest.description).toBe('In-Video Sponsorship- and Ad-Skipper');
  expect(manifest.host_permissions).toContain('<all_urls>');
  expect(manifest.content_scripts?.[0]?.matches).toContain('https://youtube.com/*');
  expect(manifest.content_scripts?.[0]?.matches).toContain('https://*.youtube.com/*');
  expect(manifest.content_scripts?.[0]?.matches).toContain('https://www.youtube.com/*');
  expect(manifest.content_scripts?.[0]?.js?.[0]).toBe('content-scripts/youtube.js');

  const contentScript = await readFile(join(process.cwd(), '.output/chrome-mv3/content-scripts/youtube.js'), 'utf8');
  expect(contentScript).toContain('YAPSKIPPR_CAPTURE_VISIBLE_TAB');
  expect(contentScript).toContain('frame-progress-bar');
  expect(contentScript).toContain('frame-qr-code');
});
