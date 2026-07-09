import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: ({ browser }) => ({
    name: 'YapSkippr',
    description: 'In-Video Sponsorship- and Ad-Skipper',
    permissions: ['storage', 'activeTab'],
    host_permissions: [
      '<all_urls>',
      'https://youtube.com/*',
      'https://www.youtube.com/*',
      'https://m.youtube.com/*',
      'https://youtu.be/*'
    ],
    action: {
      default_title: 'YapSkippr'
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'yapskippr@maz.dev',
              data_collection_permissions: {
                required: ['none']
              }
            }
          }
        }
      : {})
  })
});
