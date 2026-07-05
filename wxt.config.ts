import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'YapSkippr',
    description: 'In-Video Sponsorship- and Ad-Skipper',
    permissions: ['storage'],
    host_permissions: [
      '<all_urls>',
      'https://youtube.com/*',
      'https://www.youtube.com/*',
      'https://m.youtube.com/*',
      'https://youtu.be/*'
    ],
    action: {
      default_title: 'YapSkippr'
    }
  }
});
