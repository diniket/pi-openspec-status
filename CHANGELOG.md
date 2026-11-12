# Changelog

## 0.2.0 — 2026-11-12

- Retains all PR #5 read-only hardening, polling and CLI-alignment fixes.
- Loaded-name search, task/artifact filters, deterministic sorting and scoped summary.
- Filterable, collapsible tasks; lazy archive browsing; cooperative batch diagnostics.
- Bounded workspace scheduling, queue-inclusive timeouts, operation deadlines and shared cancellation.
- Stable focus/caret/scroll during asynchronous refresh and bounded/coalesced polling.
- Independent follow-up: retain newly owned runtimes above 32 workspaces; recognize indented
  `skip_specs: false`; render controls after skeleton creation; archive-aware empty text.

PR #5 and #6 merged sequentially with merge commits after explicit user approval.
178 regression tests pass, plus isolated real Pi Web shell GUI and independent review.
See docs/RELEASE.md for release provenance, packaging and rollback procedure.

## 0.1.0

Existing npm release; not equivalent to the unpublished PR #5 or workspace-experience branch.
