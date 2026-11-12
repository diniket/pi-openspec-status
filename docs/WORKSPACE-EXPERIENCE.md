# Workspace experience — implementation and verification

Unreleased evolution of PR #5. Base verified twice against GitHub pull/head and branch refs:
`609c6bbe9be7cf586e87e94e6718978ea411e037`. Work branch:
`feature/openspec-workspace-experience`, isolated worktree outside the installed checkout.
Implementation/test/tooling commit: `7c32cca` (documentation is committed separately).
At the final base check, main is still `2b08bce` and does not contain PR #5. The proposed PR
must therefore target `audit/final-hardening-20261112`; only this branch's new commits belong
in the review. No merge, rebase of the hardening branch or npm publication was performed.

## Implemented

| Area | Behavior / boundary |
|---|---|
| A — Discovery | Instant case-insensitive name search; task-state and missing/unknown artifact filters; deterministic name/progress/open-task order, unknown last; navigation preferences persist. All operations cover loaded data only. |
| B — Tasks | All/to-complete/completed filters, original section grouping/counts, collapsible native sections, compatible expansion persistence. Same parser/document cache; no editable checkbox or write API. |
| C — Summary | Loaded count, task-complete/in-progress count, known open tasks, unknown counts. Derived solely from index data, independent from structural diagnostics. |
| D — Archive | Separate on-demand collection, arbitrary names, bounded index/detail/document browsing, absent/empty/unreadable/partial states, same safe renderer. No archive change walk in ordinary polling. |
| E — Diagnostics | Explicit batch of all loaded changes, two workers, visible progress/results, cooperative Stop, direct change links, four result classes, cache invalidation on refresh/workspace changes. Unsupported cases remain unverified. |
| F — Hung reads | Central 15s request/queue budget, 60s operation deadline, AbortSignal, six-slot workspace scheduler, shared ownership, last-owner cancellation, obsolete-response guards, UI recovery and handled late responses/rejections. |
| G — UI | Stable controls, focus keys/caret, native details restoration, scroll preservation through temporary loading layouts; keyboard tabs; responsive 390px/1280px. |
| H — Polling | Bounded parallelism and same-workspace concurrent probe coalescing, deterministic coverage, spec content metadata still inspected, bounded error backoff, shared fresh invalidation generation for multiple panels. |

### Deliberate bounds / excluded alternatives

- Remain at 40 loaded changes per collection and 12 capability folders/documents per detail.
  The real host caps a directory at 1,000 entries and exposes no pagination/stat/recursive walk.
  Client-side traversal beyond 40 would increase index and continuous probe cost; it is not
  necessary for the requested scoped search and is not silently enabled. Unreturned host entries
  are unknown, not accessible via invented pagination.
- Stop is cooperative: no next change or next validation document is scheduled; an already shared
  detail/read may finish within its budget. Aborting that shared operation from one consumer
  would cancel another panel's requested document. Last-owner workspace exit does physically
  signal abort. A host ignoring that signal cannot be forced to cancel its own transport.
- The request budget deliberately includes queue time, with a distinct queue-timeout message.
  An overloaded workspace must not hold UI Promises indefinitely waiting for a slot.
- No directory-mtime-only shortcut, reduced spec coverage, backend, framework or dependency.
  Poll call counts are **not** reduced. CPU/RSS on production infrastructure was not measured;
  the concurrency and synthetic latency evidence below is not a resource-capacity claim.
- Structural checks are not the CLI, do not inspect main specs or cross-file conflicts, and do
  not implement custom schema, REMOVED/RENAMED or skip_specs semantics.

## Test results

Baseline `npm test`: **128 pass, 0 fail, 0 skipped**, about 3.46s.
Final: **174 pass, 0 fail, 0 skipped**, about 3.48s (128 retained + 46 new tests).

New tests cover search/filter/order, zero/unknown/truncated scope, summary purity, task filters
and expansion, navigation, lazy/large/truncated/unreadable archive, archive partial document reads,
batch/cache/Stop, unsupported metadata, timeouts, late rejection, shared last-owner cancellation,
workspace/machine switch during reads, focus/caret/scroll, concurrent probes/invalidation, per-file
spec edits and scheduler concurrency. TTL-driven index refresh also invalidates old diagnostics/open documents,
including when the host replaces the context object for the same workspace. Mixed-case names now use the same first-forty ordering in
index and probe (the old locale-vs-code-point mismatch could probe a different subset).

`scripts/regression-proof.mjs` runs actual old source from `git show 609c6bb:src/pi-web-plugin.js`
in a temporary directory and compares behavior, without replacing any active or worktree source:

| Behavioral assertion | PR #5 | New source |
|---|---|---|
| Focus retained through asynchronous detail/validity render | fails | passes |
| Never-settling refresh releases busy state | fails | passes |
| Host AbortSignal eventually aborted | fails | passes |

Executed successfully: npm test, npm run build, byte comparison, node --check on source, both
suites, DOM/FS helpers and all JS verification scripts, git diff --check, npm pack --dry-run --json.
The dry-run tarball has four entries (LICENSE, README, dist module, package.json), no bundled
runtime dependencies, about 42.0KB compressed / 151.6KB unpacked. Version remains 0.1.0;
this is not a release/publication. Temporary CLI/baseline directories are cleaned by their scripts.

## Real OpenSpec CLI reference

`scripts/cli-reference.mjs` uses installed `@fission-ai/openspec` **1.17.0** against six synthetic
changes in a temporary directory, not user projects. The browser plugin never invokes this script.

| Case | Local | CLI valid |
|---|---|---|
| ADDED with requirement/scenario | structure ok | yes |
| Empty scenario | structural error | no |
| REMOVED | unverified | yes |
| RENAMED | unverified | yes |
| skip_specs | unverified | yes |
| Missing proposal with valid delta | incomplete | yes |

Unverified is a deferral, not a false rejection. Missing proposal / Why-length requirements are
extra conservative local checks; SHALL/MUST severity matches strict rather than default CLI mode.
The historical PR #5 reports contain the larger corpus comparison; it was not repeated on private
projects for this evolution.

## Before / after polling benchmark

Reproduce with `node scripts/benchmark.mjs --baseline` and `npm run benchmark`.
Each host call waits 5ms; three iterations, median reported. All data are synthetic. The middle
case deliberately reproduces the earlier 172-call shape, **not** the production project's data.

| Shape | Calls before / after | Median ms before / after | Peak concurrent before / after |
|---|---:|---:|---:|
| 1 change × 3 capabilities | 6 / 6 | 30 / 21 | 1 / 3 |
| 40 changes, 91 capabilities | 172 / 172 | 871 / 153 | 1 / 6 |
| 40 changes × 12 capabilities | 561 / 561 | 2,839 / 482 | 1 / 6 |

Final iteration ranges (ms): baseline 30–30 / 870–872 / 2,839–2,843;
new 20–22 / 151–155 / 481–485. Coverage assertions require spec.md metadata in the fingerprint.
Dedicated tests verify spec edits with unchanged parent-directory metadata trigger refresh,
failed checks recover, and two mounted panels share one concurrent probe / fresh index generation.

## Real host and browser verification

Installed host: **@jmfederico/pi-web 1.202611.1**. `scripts/host-contract.mjs` invokes its actual
`PiWebPluginCatalog` with no live roots/config and a package provider pointing only at the worktree.
Result: openspec-status discovered, dist browser root/module, **zero diagnostics**, actual artifact
reader succeeds. The real loader predicate, API v5 activation/contribution, WorkspaceFileRequestOptions
and signal overloads are checked. Navigation and lifecycle behavior are exercised through Node and
browser harnesses; this does not substitute for an authenticated live-shell test.

Remote dedicated Pi Chromium: **155.0.8059.79**. Rechecked LAN access from that browser: navigation
to the Pi Web host still times out. Local CT has no Chromium or Playwright; none was installed.
The isolated browser test therefore imports the exact worktree dist text as a data module and
supplies synthetic host file/navigation APIs. It does not deploy the branch to Pi Web.

`scripts/browser-experience.js` contains the reproducible async function. Execute its current file
text inside a fresh browser page through CDP (strip `export`, then call `runBrowserExperience` with
the current dist text); avoid a cached Node import when iterating on the harness. On both **390px**
and **1280px**, **17 assertions pass**, no page errors/unhandled rejections, zero horizontal overflow.
Checks include contribution, lazy archive, zero-I/O typing, search focus/caret, async detail focus,
keyboard End, filtered/collapsed tasks, scroll and tab focus across refresh loading placeholders,
navigation, batch completion, archived documents, archive polling exclusion and workspace isolation.

The real browser exposed scrollTop being clamped when refreshed documents temporarily shrink to a
loading placeholder. This is fixed by retaining intended scroll across asynchronous stages while
allowing an intervening user scroll to win. Node DOM stubs cannot model this browser layout effect.
The test page was removed/closed, panel timers cancelled, and the CDP connection closed afterwards.

An independent read-only review additionally prompted backoff reset on view changes, async batch
render failure recovery, Stop-button focus fallback/expiry, and clearer archive empty states.
Shared-read cancellation and queue deadlines retain the deliberate semantics documented above.

## Active installation / operational deviation

No feature branch was installed. The live symlink remains on the original PR #5 checkout at
`609c6bb`; source and dist SHA-256 remain
`11ede8e7c1e565117f4a7764457ffab3747952ee060ed533dbf875926567607a`, identical to Git HEAD.
The active working tree is clean, with no branch, symlink, configuration, session or service changes.

One verification build was inadvertently invoked with the active checkout as its cwd. It recopied
**identical original bytes** from src to dist (timestamp-only rewrite, no feature/code change).
The CDP tool also auto-created an empty `.pi/browser-execute-workspace` there; both empty directories
were removed with rmdir after the browser tests. These are recorded as procedural deviations rather
than claiming the checkout was never touched. No rollback or service restart was needed.

## Review / delivery boundary

Code and verification are ready for independent review with the limits above. Live authenticated
shell verification remains an integration limitation, not a claimed success. No known high/critical
code defect remains from this pass; shared-read cooperative Stop and host-ignored cancellation are
explicit operational limitations. GitHub PR creation requires an authenticated GitHub client/browser;
SSH push alone is not a REST/browser login. Final delivery must record the real PR URL, not a compare
link presented as an opened PR.
