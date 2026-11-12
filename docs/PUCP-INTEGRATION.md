# PUCP integration and rollback — deployed v0.2.0

After explicit user GO, the preparation branch was fast-forwarded into canonical PUCP main at
`/home/marco/Progetti/pi-unified-control-plane`. Onlypi-hub is enabled for openspec-status-web.
Sourcev0.2.0 isb7d92d7b0fcdf281a7398f97ac93f83eaf43419a; package/module/source hashes and
npm integrity are pinned in configs/openspec-status-web/PROVENANCE.json. Four-file tarballs are
retained with matching extracted payloads. No node_modules, sessions, credentials or temp data.

Existing PUCP engine owns per-host flock, composed-payload/spec hashes, immutable directories,
atomic current, manifest/integrity checking, foreign-link refusal, automatic failed-apply rollback
and explicit rollback. No parallel installer, service, transport or link switcher was introduced.

## Actual deployment

- Baseline609c6bb first adopted with the explicitly approved PUCP ownership-transfer force option,
  after check/dry-run:1794517603-34c3305d18-7870ab4274dc.
- Verifiedv0.2.0 normal apply:1794517701-4feb742f6e-d3c5e033d9fc.
- Actual production rollback verified both filesystem and HTTP original module hash.
- Normal reapply final release: **1794517730-4feb742f6e-d3c5e033d9fc**, check ALLINEATO.

Production link points to ~/.pucp/bundles/openspec-status-web/current/package, not a development
tree. Old checkout remains clean at609c6bb; unrelated plugins and web/daemon PIDs156/162 unchanged.
No daemon restart needed. Reload browser to load the new revision.

```
./bin/pucp rollback pi-hub --bundle openspec-status-web --to 1794517603-34c3305d18-7870ab4274dc
```

This rollback ID is real and tested; retain it. Original module SHA256:
11ede8e7c1e565117f4a7764457ffab3747952ee060ed533dbf875926567607a.
Currentv0.2.0 module SHA256:
6857432a946e27c8487da97c6997d00614a20340b122148c2f7f4017068de226.

Offline verification:2 dedicated tests+84 engine tests pass, including every archive/payload byte,
inventory scope, apply/check/rollback and unrelated-plugin/foreign-link safety. Real postdeploy
HTTP manifest/byte verification and Cristina GUI immutable-package smoke complement those tests.
Release bundles do NOT implement the delegated-M5 anti-downgrade/expect-sha gates; do not claim
unsupported enforcement. Committed pinned provenance and explicit user GO are the release gates.

## Publication and retention

Remote tag push is blocked by Guardian unsupported tag-ref policy; npm needs human authentication.
These publication limits do not change deployed bytes/provenance. See RELEASE-EXECUTION.md.
Keep branches, PRs, both worktrees, package evidence and all3 release directories. No automatic
cleanup requested; inspect dirty/untracked data and references before any later cleanup.
