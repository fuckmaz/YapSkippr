```text
/make-plan Refine the YapSkippr packaged extension popup based on a Dieter Rams audit (total 20/30).

Verdict paragraph (quoted from 03-verdict.md):
> REFINE — 20/30 with no zero-scored principle: the visual and accessibility foundations are strong, but Basic mode must be reordered around the detected result, rewritten in plain and honest language, and stripped of secondary telemetry before the popup can feel genuinely minimal.

Keep (already strong, do NOT touch in this pass):
- Principle #7 (long-lasting) scored 3 — Evidence: system typography, simple geometry, a restrained accent family, and no illustration dependency in src/entrypoints/popup/style.css:1-210. Regression check: render empty and success at 390px and confirm no new decorative asset, novelty interaction, or trend-led component appears.
- Principle #8 (thorough) scored 3 — Evidence: empty/loading/error/success/focus/disabled states, keyboard-native controls, visible focus, responsive rules, and reduced motion in src/entrypoints/popup/index.html:19-200 and src/entrypoints/popup/style.css:758-900. Regression check: run packaged keyboard/state tests and verify every state remains explicit.
- Principle #9 (environmentally friendly) scored 3 — Evidence: 43,882-byte initial JS, zero startup external requests, zero idle animations, and reduced-motion support. Regression check: build Chrome, keep popup JS under 100 KB raw, inspect startup requests, and grep for keyframes/animation declarations.

Fix in priority order (top 3–5 moves from the audit, verbatim):
1. Principles #2 and #10 — Put the answer first: place permission/error recovery and detected candidate actions above telemetry; move detection-signal counts, recent activity, and faster visual-check controls to Advanced; remove empty section headings. Evidence: 01-evidence.md#visual-evidence.
2. Principle #4 — Replace detector jargon with task language: rename Detailed to Advanced, Current scan to Detection status, Candidates to Possible ad reads, Frames to Visual checks, and Fast pre-scan to Faster visual checks; distinguish scan activity from progress-bar evidence. Evidence: 01-evidence.md#copy-and-honesty-evidence.
3. Principle #6 — Make every promise literal: disclose that frame analysis requests access on all websites, describe missed-segment submission as a report, remove “safe” and undefined “high-confidence” claims, and label heuristic percentages as detector scores. Evidence: 01-evidence.md#copy-and-honesty-evidence.
4. Principles #3 and #10 — Tighten the visual system: consolidate spacing around a small intentional scale, route state colors through tokens, remove the radial wash/progress glow/beveled mark, and keep one quiet surface hierarchy. Evidence: 01-evidence.md#visual-evidence.
5. Principle #8 — Turn hierarchy into a regression gate: add packaged 390×600 empty/success/error screenshots or measured layout assertions proving the first candidate/action and recovery CTA appear in the initial viewport while focus order and all six states remain intact. Evidence: 01-evidence.md#state-and-accessibility-evidence.

Out of scope for this refine pass: detector algorithms, model calibration, server/admin UI, on-player behavior except shared copy, new dependencies, new brand assets, and a structural rewrite of popup state management.

Deliverables for the plan:
- Per-fix: target files, exact change, verification step
- Token/spec changes consolidated in one place
- Regression checklist for every "Keep" item above

Anti-patterns to guard against (specific to REFINE):
- Adding new abstractions where a direct change suffices
- Restyling areas that already scored 3
- Scope creep into structural redesign
- Letting fixes mutate principles outside the priority list
```
