# YapSkippr extension UI audit scope

## Audited surface

- Primary: the packaged browser-extension popup rendered from `src/entrypoints/popup/index.html`, `main.ts`, and `style.css`.
- Representative states: startup/loading, active scan with no candidates, detected candidate with actions, error/permission messaging, and Detailed mode.
- Secondary continuity check: the lightweight YouTube player status surface in `src/ui/player-status-ui.ts`.

## Primary user and task

The primary user is a YouTube viewer who wants YapSkippr to detect an in-video ad read, understand whether scanning is active, and either jump or safely auto-skip without losing trust in playback.

The primary task is to answer three questions at a glance:

1. Is YapSkippr working on this video?
2. Did it find a credible ad-read segment?
3. What safe action can I take now?

## Constraints

- Preserve the existing WXT, TypeScript, HTML, and CSS architecture.
- Keep Chrome/Chromium and Firefox behavior aligned.
- Retain a local-first, dark, restrained visual identity.
- Keep Basic mode genuinely minimal; advanced detector, feedback, and server controls belong in Detailed mode.
- Maintain keyboard access, explicit focus states, reduced-motion support, and readable contrast.
- Avoid new runtime dependencies or decorative assets unless evidence proves they improve the primary task.

## References and non-goals

- No competitor UI is treated as a visual target; the audit uses the shipped artifact and Dieter Rams' ten principles.
- Server admin UI is out of scope.
- Detection algorithms and model calibration are out of scope except where their state must be explained honestly in the popup.
- The audit may recommend refinement or redesign, but this artifact does not implement the handoff.
