import { createIdleScanStatus, mergeScanStatus } from '../../src/core/scan-status';
import { createActionBadgeView } from '../../src/ui/action-badge-view';

test('shows running badge while a scan is active', () => {
  const status = mergeScanStatus(createIdleScanStatus(0), {
    phase: 'frames',
    message: 'Analyzing frames...',
    progress: 0.42,
    candidateCount: 0
  }, 1_000);

  expect(createActionBadgeView(status, 3_000)).toEqual({
    text: 'RUN',
    color: '#315244',
    title: 'YapSkippr: Analyzing frames...'
  });
});

test('shows candidate count when candidates exist', () => {
  const status = mergeScanStatus(createIdleScanStatus(0), {
    phase: 'frames',
    message: 'Analyzing frames...',
    candidateCount: 125
  }, 1_000);

  expect(createActionBadgeView(status, 3_000)).toEqual({
    text: '99+',
    color: '#2f8f5b',
    title: 'YapSkippr: 125 candidate segments detected'
  });
});

test('shows stale warning for old running scans', () => {
  const status = mergeScanStatus(createIdleScanStatus(0), {
    phase: 'frames',
    message: 'Analyzing frames...'
  }, 1_000);

  expect(createActionBadgeView(status, 30_000)).toEqual({
    text: '!',
    color: '#9a6b1f',
    title: 'YapSkippr: scan status is stale'
  });
});

test('shows permission and error warnings', () => {
  const permission = mergeScanStatus(createIdleScanStatus(0), {
    phase: 'permission',
    message: 'Frame capture permission missing.'
  }, 1_000);
  const error = mergeScanStatus(createIdleScanStatus(0), {
    phase: 'error',
    message: 'Frame capture failed.'
  }, 1_000);

  expect(createActionBadgeView(permission, 3_000)).toEqual({
    text: '!',
    color: '#9a6b1f',
    title: 'YapSkippr: Frame capture permission missing.'
  });
  expect(createActionBadgeView(error, 3_000)).toEqual({
    text: 'ERR',
    color: '#9c3b3b',
    title: 'YapSkippr: Frame capture failed.'
  });
});

test('clears badge when idle', () => {
  expect(createActionBadgeView(createIdleScanStatus(0), 1_000)).toEqual({
    text: '',
    color: '#315244',
    title: 'YapSkippr'
  });
});
