import { isScanStatusStale, type ScanStatusSnapshot } from '../core/scan-status';

export interface ActionBadgeView {
  text: string;
  color: string;
  title: string;
}

export function createActionBadgeView(status: ScanStatusSnapshot, now = Date.now()): ActionBadgeView {
  if (isScanStatusStale(status, now)) {
    return {
      text: '!',
      color: '#9a6b1f',
      title: 'YapSkippr: scan status is stale'
    };
  }

  if (status.phase === 'permission') {
    return {
      text: '!',
      color: '#9a6b1f',
      title: `YapSkippr: ${status.message}`
    };
  }

  if (status.phase === 'error') {
    return {
      text: 'ERR',
      color: '#9c3b3b',
      title: `YapSkippr: ${status.message}`
    };
  }

  if (status.candidateCount > 0) {
    return {
      text: status.candidateCount > 99 ? '99+' : String(status.candidateCount),
      color: '#2f8f5b',
      title: `YapSkippr: ${status.candidateCount} candidate ${status.candidateCount === 1 ? 'segment' : 'segments'} detected`
    };
  }

  if (status.phase === 'starting' || status.phase === 'transcript' || status.phase === 'frames' || status.phase === 'fusion') {
    return {
      text: 'RUN',
      color: '#315244',
      title: `YapSkippr: ${status.message}`
    };
  }

  return {
    text: '',
    color: '#315244',
    title: 'YapSkippr'
  };
}
