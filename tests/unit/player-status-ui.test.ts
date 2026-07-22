import { PLAYER_STATUS_UI_ACCESSIBILITY, PLAYER_STATUS_UI_STYLES } from '../../src/ui/player-status-ui';

test('keeps live announcements scoped to the concise player status message', () => {
  expect(PLAYER_STATUS_UI_ACCESSIBILITY).toEqual({
    liveRegionRole: 'status',
    liveRegionPoliteness: 'polite',
    liveRegionAtomic: 'true',
    liveRegionDataRole: 'status'
  });
  expect(PLAYER_STATUS_UI_STYLES).not.toContain('aria-live');
});
