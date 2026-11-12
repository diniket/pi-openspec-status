## Base / dependency

This PR depends on **#5** and targets `audit/final-hardening-20261112` at `609c6bb`.
`main` did not yet contain #5 at the final base check. Review only the new workspace-experience
commits; the hardening commits are not duplicated in this diff. No merge or npm publication.

## Summary

- In-memory loaded-name search, task/artifact filters, deterministic sorting and compact known/unknown summary.
- Read-only task filters and collapsible sections, retaining compatible expansion/focus/scroll.
- Separate bounded, lazy archive browser with arbitrary directory names and existing Markdown renderer.
- Explicit cooperative batch structural diagnostics, progress/results and direct change navigation.
- Central request/queue timeouts, operation deadlines, AbortSignal, workspace ownership and stale-response protection.
- Six-slot parallel/coalesced polling retaining all prior spec-edit coverage; multiple-panel invalidation coalesces.

One distributable, browser-only API v5 module; zero runtime dependencies, workspace writes,
CLI execution from the plugin, services or LLM features.

## Verification

- **178 tests pass, 0 failures/skips**, including all 128 PR #5 regressions.
- Build, exact src/dist comparison, syntax checks, diff check and npm pack dry-run pass.
- Three behavior regressions demonstrably fail on `609c6bb` and pass on this branch.
- Real Pi Web **1.202611.1** catalog/artifact discovery: zero diagnostics; loader/contribution/signal contract verified.
- Second independent read-only review adjudicated; confirmed runtime pruning/shared probe/metadata bugs fixed with regressions.
- Real isolated Pi Web shell **1.202611.1** on Cristina: search/filter/sort/summary/tasks/archive/batch/Files roundtrip/workspace switch/automatic update and390px layout verified with synthetic projects.
- Real OpenSpec CLI **1.17.0**: six synthetic reference cases; unsupported cases explicitly deferred.
- Real Chromium **155.0.8059.79**, synthetic host APIs: **17 assertions pass at both 390px and 1280px**,
  no page errors/unhandled rejections or horizontal overflow. Includes scroll and deferred tab focus across refresh.

### Synthetic polling benchmark

5ms per host call, median of three iterations:

| Calls (unchanged) | PR #5 latency | New latency | Peak concurrency before → after |
|---:|---:|---:|---:|
| 6 | 30ms | 21ms | 1 → 3 |
| 172 | 872ms | 154ms | 1 → 6 |
| 561 | 2,844ms | 482ms | 1 → 6 |

The 172-call case is a synthetic equivalent, not a scan of private production data.

## Explicit limits / integration boundary

- Search/filters/totals cover only the loaded 40-change collection; truncated scope is visible.
  No server pagination exists (host listing cap: 1,000). Detail traversal remains capped at 12 folders/files.
- Task completion is not structural conformity. The inspector is not full CLI validation;
  REMOVED/RENAMED, skip_specs, custom schema and incomplete reads remain unverified.
- Stop is cooperative: no next change/validation read; a shared in-flight detail can finish within its budget.
  Physical abort is signalled only when safe (e.g. last workspace owner leaves); abort-ignoring host transports
  cannot be forcibly terminated by a browser plugin. Queue time is included in the 15s request budget;
  index/detail/validation/probe operations also have a 60s deadline.
- Real-shell GUI now uses Cristina's Firefox through a loopback SSH tunnel to an isolated instance,
  never production. No real-GUI hung-host fault injection or multi-panel race stress; those paths
  retain Node/harness coverage. Console has bundled-plugin/host warnings, no observed OpenSpec error.
- PUCP release/rollback preparation is inactive (hosts[]); final0.2.0 package, merges, tag, npm and
  production adoption/deploy all remain approval-gated.
- The live install stays at **609c6bb**, with identical original bundle bytes. No branch/symlink/config/service
  change or feature deployment. One accidental byte-identical build invocation and automatic empty CDP
  workspace directories are transparently recorded in the evidence report; the empty directories were removed.

Current measured consolidation and review: [`docs/CONSOLIDATION.md`](docs/CONSOLIDATION.md),
[`docs/SECOND-REVIEW.md`](docs/SECOND-REVIEW.md). This is a DRAFT, not permission to merge.

Historical evidence, commands, semantics and operational deviations:
[`docs/WORKSPACE-EXPERIENCE.md`](docs/WORKSPACE-EXPERIENCE.md),
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
