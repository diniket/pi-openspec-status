# Second independent review and adjudication

Reviewer: separate `reviewer` agent, deepseek-flash; reviewed feature34cd4fd against609c6bb,
read-only. This was a new review, not reuse of the previous report. Its turn limit ended the
review; the claims below were independently checked by the implementation session. No security
boundary or private transcript was accessed.

| ID | Adjudication / evidence |
|---|---|
| M1 partial parent + absent archive | Not a confirmed bug. With a truncated parent, absence is unknown; the real API does not expose a typed not-found discriminator. Replacing this with an empty archive would hide unreadable data. Regression explicitly retains error + truncated. Complete parent absence is already empty. |
| M2 nested probe queue at200ms | Claim's queue arithmetic is incorrect: at most36 nested calls with6 slots means roughly1.2s queue batches, not15s. End-to-end queue deadline is deliberate. Additional200ms benchmark records actual results; it is not grounds to silently broaden the request budget. |
| M3 runtime pruning >32 owned workspaces | **Confirmed, reproduced failing before fix** (`signal.aborted=false` after last owner leaves). Pruning now excludes the newly created runtime. Same regression passes after fix. |
| B1 probe depends on initiating panel state | **Confirmed by direct unrendered-panel probe**. Archive-count eligibility now derives from the fresh top listing (`names.length===0`), not a panel instance's state. New regression passes and active polling still excludes archive contents. |
| B2 indented false metadata | **Confirmed** regex asymmetry; false detection now accepts the same whitespace as key detection. Batch regression reports1 pass/0 unverified. Quoted/custom schema parsing remains conservative/unverified; no YAML parser is invented. |
| B3 cache cleared on last unmount | Intentional documented lifetime rule, not a hidden correctness defect. Real shell remount reloads then restores navigation/selection/task filter. Cost remains a known limit; no lifecycle rewrite added. |
| B4 archive empty ready text | Defensive archive-aware fallback applied. Ordinary empty indexes use no-active already; not reproduced as reachable normal state. |
| B5 controls before skeleton | Defensive ordering fixed. Normal mount already builds the skeleton first; no claim of a reproduced user failure. |
| B6 positional details fallback | Both existing detail creation sites have stable state keys. No current unkeyed details exist, so no reproduced state migration. |
| B7 navigation persistence each keystroke | Real Pi Web search remains focused and filters correctly; the host uses replace navigation. No measured defect justifying a behavior change. |
| B8 unexpected diagnostic enum | Internal inspector produces the closed four-state enum; batch errors normalize to unverified. No external arbitrary state source or repro. |
| B9 non-browser document global | Browser-only render path requires DOM; Node tests deliberately supply a DOM. No supported non-DOM render contract. |

Retained limits: cooperative Stop, hosts ignoring AbortSignal, no true pagination, loaded-only
counts, unsupported schema semantics, deliberate local-vs-CLI conservatism. See DEVELOPMENT.md.
