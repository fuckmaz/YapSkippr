import type { StatusUiHandle } from '../platform/adapter';
import type { SegmentCandidate } from '../core/types';
import { formatCandidateSummary } from './candidate-summary';

export function mountPlayerStatusUi(doc: Document = document): StatusUiHandle {
  doc.querySelector('#yapskippr-status-host')?.remove();

  const host = doc.createElement('div');
  host.id = 'yapskippr-status-host';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
      }

      .yapskippr-status {
        box-sizing: border-box;
        width: 100%;
        margin: 8px 0;
        padding: 8px 10px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 6px;
        background: #111;
        color: #f5f5f5;
        font: 12px system-ui, sans-serif;
      }

      .yapskippr-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .yapskippr-meter {
        height: 4px;
        margin-top: 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        overflow: hidden;
      }

      .yapskippr-meter > span {
        display: block;
        height: 100%;
        width: var(--yapskippr-progress, 0%);
        background: #33c481;
      }

      .yapskippr-candidate-list {
        margin: 8px 0 0;
        padding-left: 18px;
      }

      .yapskippr-detail-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
        margin-top: 8px;
      }

      .yapskippr-detail-grid div {
        min-width: 0;
        padding: 5px 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.04);
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
    </style>
    <section class="yapskippr-status" aria-live="polite">
      <div class="yapskippr-row">
        <span data-role="status">Starting YapSkippr scan...</span>
        <span data-role="candidates">0 candidates</span>
      </div>
      <div class="yapskippr-meter"><span></span></div>
      <dl class="yapskippr-detail-grid">
        <div>
          <dt>Video</dt>
          <dd data-role="video-time">No timing</dd>
        </div>
        <div>
          <dt>Frames</dt>
          <dd data-role="frames">0</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd data-role="evidence">0 total</dd>
        </div>
        <div>
          <dt>Sources</dt>
          <dd data-role="sources">T 0 · P 0 · QR 0 · L 0</dd>
        </div>
      </dl>
      <ol class="yapskippr-candidate-list" data-role="candidate-list"></ol>
    </section>
  `;

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

  return {
    setStatus(message: string): void {
      if (status) status.textContent = message;
    },
    setProgress(value: number): void {
      shell?.style.setProperty('--yapskippr-progress', `${Math.round(clamp(value, 0, 1) * 100)}%`);
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
      if (!candidateList) return;

      candidateList.replaceChildren(
        ...candidateSegments.slice(0, 5).map((candidate) => {
          const item = doc.createElement('li');
          const link = doc.createElement('a');
          const summary = doc.createElement('span');

          link.href = '#';
          link.dataset.seekSeconds = String(candidate.startSeconds);
          link.textContent = formatTimestamp(candidate.startSeconds);
          summary.textContent = ` ${formatCandidateSummary(candidate)}`;
          item.append(link, summary);
          return item;
        })
      );
    },
    destroy(): void {
      host.remove();
    }
  };
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
