import type { StatusUiHandle } from '../platform/adapter';
import type { SegmentCandidate } from '../core/types';
import { formatCandidateSummary } from './candidate-summary';
import { createStableListRenderer } from './stable-list-renderer';

export const PLAYER_STATUS_UI_STYLES = `
      :host {
        display: block;
        width: 100%;
      }

      .yapskippr-status {
        box-sizing: border-box;
        width: 100%;
        margin: 10px 0;
        padding: 10px 12px;
        border: 1px solid rgba(128, 231, 177, 0.2);
        border-radius: 10px;
        background: linear-gradient(145deg, rgba(17, 22, 20, 0.98), rgba(12, 15, 14, 0.98));
        color: #f3f7f5;
        font: 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.18), inset 0 1px rgba(255, 255, 255, 0.03);
      }

      .yapskippr-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .yapskippr-status-copy {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .yapskippr-status-dot {
        width: 7px;
        height: 7px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: #52d896;
        box-shadow: 0 0 0 4px rgba(82, 216, 150, 0.1);
      }

      .yapskippr-meter {
        height: 5px;
        margin-top: 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
      }

      .yapskippr-meter > span {
        display: block;
        height: 100%;
        width: var(--yapskippr-progress, 0%);
        border-radius: inherit;
        background: linear-gradient(90deg, #2fbd79, #77e7ac);
        box-shadow: 0 0 10px rgba(82, 216, 150, 0.26);
        transition: width 220ms ease;
      }

      .yapskippr-candidate-list {
        margin: 8px 0 0;
        padding-left: 18px;
      }

      .yapskippr-skip-notice {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 9px;
        padding: 7px 8px 7px 10px;
        border: 1px solid rgba(82, 216, 150, 0.24);
        border-radius: 8px;
        background: rgba(82, 216, 150, 0.08);
        color: rgba(245, 245, 245, 0.9);
      }

      .yapskippr-skip-notice[hidden] {
        display: none;
      }

      .yapskippr-skip-notice button {
        min-height: 26px;
        padding: 0 9px;
        border: 1px solid rgba(82, 216, 150, 0.4);
        border-radius: 7px;
        background: rgba(82, 216, 150, 0.14);
        color: #a8f0cd;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
      }

      .yapskippr-skip-notice button:hover {
        background: rgba(82, 216, 150, 0.22);
      }

      .yapskippr-skip-notice button:focus-visible {
        outline: 2px solid rgba(82, 216, 150, 0.62);
        outline-offset: 2px;
      }

      .yapskippr-detail-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 7px;
        margin-top: 9px;
      }

      .yapskippr-detail-grid div {
        min-width: 0;
        padding: 6px 7px;
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.035);
      }

      .yapskippr-detail-grid dt {
        color: rgba(245, 245, 245, 0.56);
        font-size: 10px;
        text-transform: uppercase;
      }

      .yapskippr-detail-grid dd {
        margin: 2px 0 0;
        color: rgba(245, 245, 245, 0.92);
        font-weight: 650;
        overflow-wrap: anywhere;
      }

      .yapskippr-candidate-list:empty {
        display: none;
      }

      .yapskippr-candidate-list li {
        margin-top: 4px;
        color: rgba(245, 245, 245, 0.86);
        line-height: 1.35;
      }

      .yapskippr-candidate-list a {
        color: #8de0b3;
        font-weight: 700;
        text-decoration: none;
      }

      .yapskippr-candidate-list a:hover {
        text-decoration: underline;
      }

      @media (max-width: 720px) {
        .yapskippr-detail-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .yapskippr-meter > span {
          transition: none;
        }
      }
  `;

export const PLAYER_STATUS_UI_ACCESSIBILITY = {
  liveRegionRole: 'status',
  liveRegionPoliteness: 'polite',
  liveRegionAtomic: 'true',
  liveRegionDataRole: 'status'
} as const;

export function mountPlayerStatusUi(doc: Document = document): StatusUiHandle {
  doc.querySelector('#yapskippr-status-host')?.remove();

  const host = doc.createElement('div');
  host.id = 'yapskippr-status-host';
  const shadow = host.attachShadow({ mode: 'open' });
  appendPlayerStatusUi(doc, shadow);

  const anchor = doc.querySelector('#player') ?? doc.querySelector('#primary') ?? doc.body;
  if (anchor === doc.body) {
    doc.body.prepend(host);
  } else {
    anchor.insertAdjacentElement('afterend', host);
  }

  const status = shadow.querySelector<HTMLElement>('[data-role="status"]');
  const candidates = shadow.querySelector<HTMLElement>('[data-role="candidates"]');
  const candidateList = shadow.querySelector<HTMLOListElement>('[data-role="candidate-list"]');
  const videoTime = shadow.querySelector<HTMLElement>('[data-role="video-time"]');
  const frames = shadow.querySelector<HTMLElement>('[data-role="frames"]');
  const evidence = shadow.querySelector<HTMLElement>('[data-role="evidence"]');
  const sources = shadow.querySelector<HTMLElement>('[data-role="sources"]');
  const shell = shadow.querySelector<HTMLElement>('.yapskippr-status');
  const progress = shadow.querySelector<HTMLElement>('[data-role="progress"]');
  const skipNotice = shadow.querySelector<HTMLElement>('[data-role="skip-notice"]');
  const skipNoticeText = shadow.querySelector<HTMLElement>('[data-role="skip-notice-text"]');
  const undoSkipButton = shadow.querySelector<HTMLButtonElement>('[data-role="undo-skip"]');
  let undoAutoSkip: (() => void) | null = null;
  const candidateListRenderer = candidateList
    ? createStableListRenderer<SegmentCandidate, HTMLLIElement>({
        target: candidateList,
        fingerprint: (candidate) => [
          candidate.startSeconds,
          candidate.endSeconds ?? null,
          candidate.confidence,
          formatCandidateSummary(candidate)
        ],
        createNode: (candidate) => createCandidateListItem(doc, candidate)
      })
    : null;

  candidateList?.addEventListener('click', (event) => {
    const link = event.target instanceof HTMLElement ? event.target.closest<HTMLAnchorElement>('a[data-seek-seconds]') : null;
    if (!link) return;
    event.preventDefault();

    const seekSeconds = Number(link.dataset.seekSeconds);
    const video = doc.querySelector<HTMLVideoElement>('video.html5-main-video');
    if (video && Number.isFinite(seekSeconds)) {
      video.currentTime = Math.min(seekSeconds, Number.isFinite(video.duration) ? video.duration : seekSeconds);
      video.play().catch(() => undefined);
    }
  });

  undoSkipButton?.addEventListener('click', () => {
    const action = undoAutoSkip;
    undoAutoSkip = null;
    if (skipNotice) skipNotice.hidden = true;
    action?.();
  });

  return {
    setStatus(message: string): void {
      if (status) status.textContent = message;
    },
    setProgress(value: number): void {
      const progressPercent = Math.round(clamp(value, 0, 1) * 100);
      shell?.style.setProperty('--yapskippr-progress', `${progressPercent}%`);
      progress?.setAttribute('aria-valuenow', String(progressPercent));
    },
    setDetails(details): void {
      if (videoTime) videoTime.textContent = formatVideoTime(details.videoCurrentTimeSeconds, details.videoDurationSeconds);
      if (frames) frames.textContent = String(details.sampleCount);
      if (evidence) evidence.textContent = `${details.evidenceCounts.total} total`;
      if (sources) {
        sources.textContent = [
          `T ${details.evidenceCounts.transcript}`,
          `P ${details.evidenceCounts.progressBar}`,
          `QR ${details.evidenceCounts.qrCode}`,
          `L ${details.evidenceCounts.visibleLink}`
        ].join(' · ');
      }
    },
    setCandidates(candidateSegments: SegmentCandidate[]): void {
      const count = candidateSegments.length;
      if (candidates) candidates.textContent = `${count} ${count === 1 ? 'candidate' : 'candidates'}`;
      candidateListRenderer?.render(candidateSegments.slice(0, 5));
    },
    showAutoSkipNotice(notice): void {
      undoAutoSkip = notice?.onUndo ?? null;
      if (!skipNotice) return;
      if (!notice) {
        skipNotice.hidden = true;
        return;
      }

      const roundedSeconds = Math.max(1, Math.round(notice.skippedSeconds));
      if (skipNoticeText) {
        skipNoticeText.textContent = `Skipped ${formatDuration(roundedSeconds)} of detected ad read.`;
      }
      skipNotice.hidden = false;
    },
    destroy(): void {
      undoAutoSkip = null;
      host.remove();
    }
  };
}

function appendPlayerStatusUi(doc: Document, shadow: ShadowRoot): void {
  const style = doc.createElement('style');
  style.textContent = PLAYER_STATUS_UI_STYLES;

  const shell = doc.createElement('section');
  shell.className = 'yapskippr-status';

  const row = doc.createElement('div');
  row.className = 'yapskippr-row';
  const statusCopy = doc.createElement('span');
  statusCopy.className = 'yapskippr-status-copy';
  const statusDot = doc.createElement('i');
  statusDot.className = 'yapskippr-status-dot';
  statusDot.setAttribute('aria-hidden', 'true');
  const status = doc.createElement('span');
  status.dataset.role = PLAYER_STATUS_UI_ACCESSIBILITY.liveRegionDataRole;
  status.setAttribute('role', PLAYER_STATUS_UI_ACCESSIBILITY.liveRegionRole);
  status.setAttribute('aria-live', PLAYER_STATUS_UI_ACCESSIBILITY.liveRegionPoliteness);
  status.setAttribute('aria-atomic', PLAYER_STATUS_UI_ACCESSIBILITY.liveRegionAtomic);
  status.textContent = 'Starting YapSkippr scan...';
  statusCopy.append(statusDot, status);

  const candidateCount = doc.createElement('span');
  candidateCount.dataset.role = 'candidates';
  candidateCount.textContent = '0 candidates';
  row.append(statusCopy, candidateCount);

  const meter = doc.createElement('div');
  meter.className = 'yapskippr-meter';
  meter.dataset.role = 'progress';
  meter.setAttribute('role', 'progressbar');
  meter.setAttribute('aria-label', 'YapSkippr scan progress');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', '100');
  meter.setAttribute('aria-valuenow', '0');
  meter.append(doc.createElement('span'));

  const details = doc.createElement('dl');
  details.className = 'yapskippr-detail-grid';
  details.append(
    createDetailItem(doc, 'Video', 'video-time', 'No timing'),
    createDetailItem(doc, 'Frames', 'frames', '0'),
    createDetailItem(doc, 'Evidence', 'evidence', '0 total'),
    createDetailItem(doc, 'Sources', 'sources', 'T 0 · P 0 · QR 0 · L 0')
  );

  const candidateList = doc.createElement('ol');
  candidateList.className = 'yapskippr-candidate-list';
  candidateList.dataset.role = 'candidate-list';

  const skipNotice = doc.createElement('div');
  skipNotice.className = 'yapskippr-skip-notice';
  skipNotice.dataset.role = 'skip-notice';
  skipNotice.hidden = true;
  const skipNoticeText = doc.createElement('span');
  skipNoticeText.dataset.role = 'skip-notice-text';
  const undoSkipButton = doc.createElement('button');
  undoSkipButton.type = 'button';
  undoSkipButton.dataset.role = 'undo-skip';
  undoSkipButton.textContent = 'Undo';
  skipNotice.append(skipNoticeText, undoSkipButton);

  shell.append(row, meter, details, candidateList, skipNotice);
  shadow.append(style, shell);
}

function createDetailItem(doc: Document, label: string, role: string, value: string): HTMLDivElement {
  const item = doc.createElement('div');
  const term = doc.createElement('dt');
  const description = doc.createElement('dd');
  term.textContent = label;
  description.dataset.role = role;
  description.textContent = value;
  item.append(term, description);
  return item;
}

function createCandidateListItem(doc: Document, candidate: SegmentCandidate): HTMLLIElement {
  const item = doc.createElement('li');
  const link = doc.createElement('a');
  const summary = doc.createElement('span');
  link.href = '#';
  link.dataset.seekSeconds = String(candidate.startSeconds);
  link.textContent = formatTimestamp(candidate.startSeconds);
  summary.textContent = ` ${formatCandidateSummary(candidate)}`;
  item.append(link, summary);
  return item;
}

function formatVideoTime(current: number | null, duration: number | null): string {
  if (current === null || duration === null) return 'No timing';
  return `${formatTimestamp(current)} / ${formatTimestamp(duration)}`;
}

function formatTimestamp(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
