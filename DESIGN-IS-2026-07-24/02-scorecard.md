# YapSkippr extension UI scorecard

1. Good design is innovative — Score: 2/3
   Evidence: The popup adapts familiar extension controls with transparent multi-signal status, feedback, and reversible on-player skipping (`01-evidence.md#principle-indexed-facts`).
   Justification: It refreshes an existing extension-dashboard pattern with useful product-specific behavior, but does not introduce an interaction pattern unseen across peer products.

2. Good design makes a product useful — Score: 2/3
   Evidence: The result has a direct jump action, yet the first success candidate begins around y=621 in a 600 px viewport (`01-evidence.md#visual-evidence`).
   Justification: The primary task is supported, but telemetry and adjacent controls force an unnecessary scroll before the user reaches the answer.

3. Good design is aesthetic — Score: 2/3
   Evidence: The charcoal/green family is coherent, while 45 literal colors and one 10.83 px orphan type size sit outside the visible token system (`01-evidence.md#visual-evidence`).
   Justification: The surface is visually composed and restrained, with two system-level inconsistencies that keep it from a fully resolved score.

4. Good design makes a product understandable — Score: 1/3
   Evidence: `Fast pre-scan`, synthetic `Scan progress`, `% confidence`, and broad `Frame capture access` all need explanation or map imperfectly to behavior (`01-evidence.md#copy-and-honesty-evidence`).
   Justification: More than two primary concepts are unclear and technical jargon remains visible in Basic mode.

5. Good design is unobtrusive — Score: 2/3
   Evidence: There are no modals or idle animations, but nested metric and control cards occupy the first viewport ahead of the result (`01-evidence.md#visual-evidence`).
   Justification: The chrome is quiet, yet too visible relative to the candidate content.

6. Good design is honest — Score: 1/3
   Evidence: Default-off consent is explicit, but all-site permission scope, immediate-learning language, synthetic progress, and confidence wording are under-disclosed (`01-evidence.md#copy-and-honesty-evidence`).
   Justification: Multiple inflations and one material permission-scope omission prevent a stronger score, although no forced or deceptive transaction flow exists.

7. Good design is long-lasting — Score: 3/3
   Evidence: The interface relies on system typography, simple geometry, one restrained accent family, and no fashionable illustration system (`01-evidence.md#visual-evidence`).
   Justification: The visual language has no load-bearing trend marker likely to date the product within three years.

8. Good design is thorough down to the last detail — Score: 3/3
   Evidence: Empty, loading, error, success, focus, and disabled states all exist, with keyboard access, contrast, reduced motion, and responsive rules (`01-evidence.md#state-and-accessibility-evidence`).
   Justification: Every required state is implemented and intentionally styled.

9. Good design is environmentally friendly — Score: 3/3
   Evidence: Initial JS is 43,882 bytes, startup has no external request, idle animation count is zero, and reduced motion is honored (`01-evidence.md#weight-and-friction-evidence`).
   Justification: The popup clears the strict resource, motion, and attention thresholds for this principle.

10. Good design is as little design as possible — Score: 1/3
    Evidence: Basic shows telemetry, faster-scan controls, auto-skip, empty headings, missed reporting, activity, and permission before or around the result; feedback actions are duplicated (`01-evidence.md#structural-evidence`).
    Justification: At least three removable or deferrable groups compete with the primary task, even though Advanced mode already provides a place for secondary detail.

## Total

**20/30**
