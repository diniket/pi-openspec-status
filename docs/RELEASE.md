# v0.2.0 release

Explicit user approval to complete the reserved merge/tag/npm/PUCP operations was received
on2026-11-12. Session daemon restart remains unauthorized and unnecessary.

## Verified sequential merges

1. PR#5 https://github.com/diniket/pi-openspec-status/pull/5 merged into main as
   `0e49fd065df5f919f4064f1e30639e6e022cc262`, preserving head609c6bb.
2. PR#6 https://github.com/diniket/pi-openspec-status/pull/6 retargeted to main after#5,
   feature-only23-file diff verified; merged as
   `06210b677ba7565b0dc4a36f3cdd8bca084b9282`, preserving head60d29d4.

Both merges used no-ff merge commits and ordinary Guardian-protected main pushes from this
isolated worktree. GitHub API confirms both closed/merged. No force/rebase/squash and no
branch/worktree deletion. Main contains609c6bb and60d29d4 by ancestry checks.

## Version/package/tag verification

The version/changelog release commit follows both merges. Resolve the final source with
`git rev-parse v0.2.0^{commit}` after inspecting the annotated tag. Package from that exact source,
not a development tree: `npm pack --json --ignore-scripts`; inspect the exact four-file allowlist
(LICENSE,README,package.json,dist/pi-web-plugin.js), module SHA256, tarball SHA256/npm integrity.
No dependencies, node_modules, temporary data, sessions or credentials belong in the package.

Before tag/deploy run178 Node tests, build/source-dist/syntax/diff/pack checks, real installed
PiWeb1.202611.1 catalog/artifact contract, CLI1.17.0 reference and baseline regression proof.
The real-shell Cristina GUI and separate Chromium155 harness evidence are in CONSOLIDATION.md.
After deployment repeat served-byte/manifest/GUI checks without restarting the daemon.

Annotated tag command: `git tag -a v0.2.0 <release-sha> -m 'OpenSpec Status Web v0.2.0'`,
inspect object then plain guarded `git push origin v0.2.0`. Never force/retag an existing version.
Tag source SHA and package checksums are recorded in the execution report once measured.

## npm (separate from deployment)

Registry package `pi-openspec-status-web` is owned by `diniket`; existing latest0.1.0.
Initial `npm whoami` checks on pi-hub and Cristina returned401: publication is not claimed until
an authenticated account with maintainer rights is measured. Never copy/read authentication
tokens into chat, repository, logs or another machine. Use normal npm web login if required.
After authentication, publish ONLY the verified v0.2.0 tarball using `npm publish <tarball>
--access public`, then compare registry dist integrity with the approved package. Existing
version rejection is a stop, not permission to overwrite. No duplicate publication.

## PUCP and rollback

Use the existing PUCP release bundle, pinned package/source hashes, committed provenance and
baseline-first ownership adoption. Check/dry-run, adopt609c6bb baseline under the specifically
approved force ownership-transfer mechanism, then apply the verified0.2.0 candidate normally.
Verify immutable current release, HTTP module bytes and GUI. Record baseline/candidate release
IDs. Rollback only this bundle to the verified baseline and verify its module SHA. No daemon
restart or unrelated-plugin modification. Detailed runbook: PUCP-INTEGRATION.md and PUCP
`docs/openspec-plugin-release.md`.

## Compatibility / release notes

CHANGELOG.md contains the release highlights. One browser-only APIv5 module, zero runtime
dependencies, read-only workspace APIs. Loaded-only counts/search(max40), max12 capabilities,
cooperative Stop,15s queue-inclusive request timeout and60s scan deadline. Local structure pass
is not CLI validation; unsupported/custom metadata remains unverified. Host-ignored AbortSignal
cannot forcibly terminate transport. Real GUI fault-injection/federation remain untested.
