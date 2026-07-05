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

      .yapskippr-candidate-list:empty {
        display: none;
      }

      .yapskippr-candidate-list li {
        margin-top: 4px;
        color: rgba(245, 245, 245, 0.86);
        line-height: 1.35;
      }
    </style>
    <section class="yapskippr-status" aria-live="polite">
      <div class="yapskippr-row">
        <span data-role="status">Starting YapSkippr scan...</span>
        <span data-role="candidates">0 candidates</span>
      </div>
      <div class="yapskippr-meter"><span></span></div>
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
  const shell = shadow.querySelector<HTMLElement>('.yapskippr-status');

  return {
    setStatus(message: string): void {
      if (status) status.textContent = message;
    },
    setProgress(value: number): void {
      shell?.style.setProperty('--yapskippr-progress', `${Math.round(clamp(value, 0, 1) * 100)}%`);
    },
    setCandidates(candidateSegments: SegmentCandidate[]): void {
      const count = candidateSegments.length;
      if (candidates) candidates.textContent = `${count} ${count === 1 ? 'candidate' : 'candidates'}`;
      if (!candidateList) return;

      candidateList.replaceChildren(
        ...candidateSegments.slice(0, 5).map((candidate) => {
          const item = doc.createElement('li');
          item.textContent = formatCandidateSummary(candidate);
          return item;
        })
      );
    },
    destroy(): void {
      host.remove();
    }
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
