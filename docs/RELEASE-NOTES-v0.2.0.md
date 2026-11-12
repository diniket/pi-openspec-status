# OpenSpec Status Web v0.2.0

Read-only **OpenSpec** panel for PI WEB: loaded-change search, filters and sorting, operational
summary, filterable/collapsible tasks, on-demand archive, cooperative batch structure checks and a
resilient read lifecycle. One browser-only API v5 module, zero runtime dependencies, no writes.

## Highlights

- Loaded-name search, task-state/artifact filters, deterministic sorting (unknown counts last).
- Compact summary: loaded, task-complete/in-progress, known open tasks, unknown counts.
- Task viewer with all/to-complete/completed filters and native collapsible sections.
- Lazy archive browser with arbitrary directory names; ordinary polling never walks the archive.
- Explicit cooperative batch structural diagnostics with per-change results and navigation.
- Bounded scheduling: 15 s request budget including queue time, 60 s operation deadline,
  AbortSignal, workspace owner refcounts, obsolete-response guards.
- Stable focus/caret/scroll across refresh; bounded, coalesced polling with stale-data warning.

## Compatibility and limits

- Verified with Pi Web 1.202611.1 (plugin API v5) and OpenSpec CLI 1.17.0 reference cases.
- Search/filters/totals cover the loaded collection (max 40 changes; 12 capability folders/files
  per detail). Host listings cap at 1,000 entries and expose no pagination.
- Structure checks are local and conservative, **not** `openspec validate`: STOP is cooperative and
  REMOVED/RENAMED, `skip_specs`, custom schemas and incomplete reads stay unverified.
- A host transport that ignores AbortSignal cannot be forcibly terminated by a browser plugin.
- Task completion is not structural conformity; unknown counts are never reported as zero.

## Verification

178 Node tests pass (all 128 PR #5 regressions retained), build/source-dist equality, pack allowlist,
installed-host catalog/artifact/loader contract, real CLI reference cases, baseline regression proof
and real Chromium harness at 390 px and 1280 px. Merged via PRs #5 and #6.

Checksums of the exact published package (4 files: LICENSE, README.md, dist/pi-web-plugin.js,
package.json):

- tarball SHA-256 `f68f1a9f5796b4d3172654ee66fc4c370928178b574c769668c3a592b9ed0b79`
- module SHA-256 `6857432a946e27c8487da97c6997d00614a20340b122148c2f7f4017068de226`

Install: Settings → Pi packages → `npm:pi-openspec-status-web`, enable in Settings → PI WEB plugins,
reload the page (browser-only plugin; no session-daemon restart). Managed deployments should use a
verified immutable release rather than a writable Git checkout.
