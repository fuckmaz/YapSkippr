# YapSkippr extension UI evidence

## Structural evidence

- The popup contains 18 static controls; Basic/idle exposes seven, two initially disabled. Runtime candidate rows add four controls each, while detailed evidence rows add three feedback controls each. Sources: `src/entrypoints/popup/index.html:19-200`, `src/entrypoints/popup/main.ts:336-388`, `src/entrypoints/popup/main.ts:1306-1345`.
- Maximum nesting is seven elements below `<main>` in the detailed consent and evidence-action paths. Sources: `src/entrypoints/popup/index.html:10-190`, `src/entrypoints/popup/main.ts:366-388`.
- One duplicate-purpose pattern repeats `Good / Wrong / Timing` feedback on both candidate and raw-evidence rows. Sources: `src/core/feedback.ts:16-20`, `src/entrypoints/popup/main.ts:336-388`.
- Basic mode still presents status, three scan metrics, four evidence metrics, faster-scan controls, auto-skip, candidates, missed-report entry, recent activity, update time, and frame permission. Source: `src/entrypoints/popup/index.html:25-200`.
- Empty lists disappear, but the empty Basic render retains orphan `CANDIDATES` and `RECENT ACTIVITY` headings. Sources: `src/entrypoints/popup/style.css:409-419`, `src/entrypoints/popup/style.css:477-487`; rendered evidence `popup-empty-full-390.png`.
- Two view fields have no shipping consumer: `PopupEvidenceItem.label` and `PopupScanStatusView.isRunning`. Sources: `src/ui/popup-scan-status-view.ts:4-26`, `src/ui/popup-scan-status-view.ts:88-120`, `src/entrypoints/popup/main.ts:290-293`.

## Visual evidence

- The packaged Chromium popup was rendered at the real extension URL in a 390×600 viewport across empty, loading, error, success, and keyboard-focus states.
- Full-page height is 880 px empty and 1003 px with one successful candidate. In the success render, the candidate begins around y=621, below the 600 px initial viewport; the permission control begins around y=912. Screenshot: `/tmp/yapskippr-design-audit-20260724-0741/popup-success-full-390.png`.
- The observed spacing values are `[1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 14, 16]` px, plus 5 px in hidden controls. Sources: `src/entrypoints/popup/style.css:1-900`.
- The rendered type scale is `[10, 10.83, 11, 12, 13, 17]` px. The browser-derived 10.83 px Recent activity detail is the only orphan size. Source: `src/entrypoints/popup/style.css:509-512`.
- CSS references 45 literal colors (26 hex and 19 rgba) despite a 12-token root palette. Sources: `src/entrypoints/popup/style.css:1-15`, `src/entrypoints/popup/style.css:16-900`.
- The visual family is consistent charcoal/green with thin borders, rounded panels, aligned cards, and tabular metrics. Persistent decoration is limited to a radial wash, beveled brand mark, panel shadow, and progress glow. Sources: `src/entrypoints/popup/style.css:21-29`, `src/entrypoints/popup/style.css:95-105`, `src/entrypoints/popup/style.css:132-210`.

## State and accessibility evidence

- Empty, loading, error, success, focus, and disabled states are all present in production code and rendered captures. Sources: `src/core/scan-status.ts:107-142`, `src/ui/popup-scan-status-view.ts:56-120`, `src/entrypoints/popup/style.css:171-181`, `src/entrypoints/popup/style.css:779-793`.
- Error state uses text, a red pill, explanatory copy, and a red activity marker; it does not rely on color alone. Screenshot: `/tmp/yapskippr-design-audit-20260724-0741/popup-error-full-390.png`.
- The lowest enabled primary-text contrast measured 7.14:1 (`#9ba8a2` over the composited raised surface), passing WCAG AA. Disabled text measured 4.39:1 and is contrast-exempt.
- Focus uses a visible 2 px green outline with 2 px offset. Source: `src/entrypoints/popup/style.css:779-786`; screenshot: `/tmp/yapskippr-design-audit-20260724-0741/popup-focus-390x600.png`.
- Measured Basic-success focus order: Basic, Detailed, interval select, Auto-skip, Jump, Good, Wrong, Timing, Report, Grant access. Disabled faster scan is correctly skipped.
- All primary controls use keyboard-native buttons/selects/inputs; Report and Detailed open with Enter. Source: `src/entrypoints/popup/index.html:19-200`.
- Basic contains one `main` plus five named region landmarks. Detailed adds one named region. There is no skip link; for this short extension popup, the more material issue is excessive landmark/content density.
- The progressbar exposes label, min, max, and current value. Sources: `src/entrypoints/popup/index.html:34-36`, `src/entrypoints/popup/main.ts:283-286`.

## Copy and honesty evidence

- Useful direct labels include `Jump to {time}`, explicit start/end timecodes, default-off feedback, and bounded auto-skip behavior. Sources: `src/ui/popup-scan-status-view.ts:94-101`, `src/entrypoints/popup/index.html:86-120`, `src/entrypoints/popup/index.html:159-168`.
- Basic mode contains unexplained technical language: `scan`, `frames`, `candidates`, `evidence`, `fusion`, and `heuristic fallback`. Sources: `src/entrypoints/popup/index.html:25-70`, `src/ui/popup-scan-status-view.ts:56-66`, `src/ui/popup-scan-status-view.ts:153-175`.
- `Progress` refers both to scan completion and progress-bar evidence. Source: `src/entrypoints/popup/index.html:34-36`, `src/entrypoints/popup/index.html:58-61`.
- `Fast pre-scan` does not scan ahead; it increases screenshot frequency for the currently visible frame. Sources: `src/entrypoints/popup/index.html:71-84`, `src/entrypoints/youtube.content/index.ts:603-610`, `src/core/analysis/frame-sampler.ts:67-81`.
- `Teach YapSkippr` sends a feedback report but does not update the local detector. Sources: `src/entrypoints/popup/index.html:97-103`, `src/entrypoints/popup/main.ts:921-939`, `src/entrypoints/popup/main.ts:1045-1053`.
- `Grant frame capture access` requests optional `<all_urls>` access, which the Basic surface does not disclose. Sources: `src/entrypoints/popup/index.html:194-199`, `src/entrypoints/popup/main.ts:60`, `src/entrypoints/popup/main.ts:404-410`, `wxt.config.ts:16-18`.
- `% confidence` may read as calibrated probability when the value can be a heuristic score. Source: `src/ui/popup-scan-status-view.ts:169-175`.
- No forced opt-in, urgency, confirmshaming, hidden payment, or obstructed opt-out was found. Auto-skip and feedback both default off. Sources: `src/entrypoints/popup/index.html:86-92`, `src/entrypoints/popup/index.html:159-168`.

## Weight and friction evidence

- Packaged popup JavaScript is 43,882 raw bytes; CSS is 11,922 bytes; HTML is 9,335 bytes. Total initial local resources are 65,139 raw bytes across three extension-local requests.
- Startup makes zero unconditional external requests. A network POST occurs only after authorized, explicit feedback submission. Sources: `src/entrypoints/popup/main.ts:229-245`, `src/entrypoints/popup/main.ts:984-1053`.
- Median measured `DOMContentLoaded` was 30.9 ms across nine fresh popup loads; the Detailed handler responded within timer resolution.
- Idle animation count is zero. Four state transitions are removed under `prefers-reduced-motion`. Sources: `src/entrypoints/popup/style.css:195-210`, `src/entrypoints/popup/style.css:611-645`, `src/entrypoints/popup/style.css:758-833`.
- The initial surface contains no toast or modal and one scan-phase badge. It declares eight polite live regions, five in Basic and three hidden in Detailed. Source: `src/entrypoints/popup/index.html:84-197`.
- The UI is intentionally dark and supports reduced motion, but has no light-theme token set. Sources: `src/entrypoints/popup/style.css:1-15`, `src/entrypoints/popup/style.css:826-833`.

## Principle-indexed facts

1. Innovative: transparent multi-signal status, explicit feedback, and on-player Undo adapt standard extension patterns to a detection/skipping workflow.
2. Useful: core actions exist and respond quickly, but the detected candidate is below the initial viewport because secondary telemetry precedes it.
3. Aesthetic: the rendered family is cohesive; token proliferation and an orphan font size weaken the system.
4. Understandable: status states and actions are explicit, but at least four technical or behavior-mismatched labels require interpretation.
5. Unobtrusive: there is no idle motion or modal interruption; nested metric/control cards still compete with the result.
6. Honest: privacy and default-off behavior are strong; permission scope, synthetic progress, learning language, and confidence language are under-explained.
7. Long-lasting: system typography, restrained color, and simple geometry avoid a dependency on a transient illustration or component trend.
8. Thorough: all six required states, focus, keyboard access, live status, reduced motion, and responsive behavior are implemented.
9. Environmentally friendly: the popup is under 100 KB raw, uses no external startup network, has no idle animation, and honors reduced motion.
10. As little design as possible: Advanced hides true diagnostics, but Basic still prioritizes telemetry and repeated affordances over the candidate/result.

## Known gaps

- Firefox was built but not visually rendered for this audit.
- The browser permission prompt itself was not invoked; exact browser wording remains unverified.
- No screen-reader announcement sequence or user comprehension study was run.
- Loading/error/success snapshots were injected through real extension session storage and rendered by production code rather than produced by a live YouTube scan.
