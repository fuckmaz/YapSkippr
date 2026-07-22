import { defineConfig } from 'wxt';
import { FEEDBACK_DATA_COLLECTION_CATEGORIES } from './src/core/feedback-consent';

export default defineConfig({
  srcDir: 'src',
  manifest: ({ browser }) => ({
    name: 'YapSkippr',
    description: 'In-Video Sponsorship- and Ad-Skipper',
    permissions: ['storage', 'activeTab', 'alarms'],
    host_permissions: [
      'https://youtube.com/*',
      'https://www.youtube.com/*',
      'https://m.youtube.com/*',
      'https://youtu.be/*'
    ],
    ...(browser === 'firefox'
      ? { optional_permissions: ['<all_urls>'] }
      : { optional_host_permissions: ['<all_urls>'] }),
    action: {
      default_title: 'YapSkippr'
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko_android: {
              strict_min_version: '142.0'
            },
            gecko: {
              id: 'yapskippr@maz.dev',
              strict_min_version: '140.0',
              data_collection_permissions: {
                required: ['none'],
                optional: [...FEEDBACK_DATA_COLLECTION_CATEGORIES]
              }
            }
          }
        }
      : {})
  })
});
