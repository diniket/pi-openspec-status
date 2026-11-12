# PUCP integration and rollback

Prepared in the separate PUCP worktree
`/home/marco/Progetti/pi-unified-control-plane-openspec`, branch
`feature/openspec-plugin-release`; the main PUCP checkout is untouched.

The inactive `openspec-status-web` release bundle uses the **existing** release engine:
per-host flock, composed-payload/spec hashes, immutable release directories, atomic `current`,
manifest/integrity checks, ownership rules, automatic failed-apply rollback and explicit rollback.
No parallel deployment system was created. Only this plugin's destination is declared; unrelated
plugins remain unmanaged. Inventory has `hosts: []` to prevent any production application.

Payloads contain only npm's allowlisted LICENSE, README, package.json and dist module; provenance
pins source commit, package SHA-256/npm integrity and module SHA-256. Active609c6bb baseline
rollback was packaged independently from Git, not copied from an unverified working directory.
Candidate remains a pre-release 0.1.0 package; replace it with the approved v0.2.0 artifact later.

Offline proof executes the actual PUCP engine with actual module bytes in a fake HOME:
baseline apply -> candidate apply -> check -> baseline rollback; unrelated-plugin preservation;
refusal of a foreign development link. Existing engine suite also runs offline. See
`tests/test_openspec_release.py` and `docs/openspec-plugin-release.md` in the PUCP worktree.

## Approval boundary

Production still follows `/home/marco/Progetti/pi-openspec-status-web` at609c6bb.
Its current unmanaged link is **not adopted**. Baseline-first managed adoption and pi-hub host
activation require explicit GO. Normal PUCP apply refuses the foreign link; a specifically
approved ownership transfer may use PUCP's existing force mechanism, not manual link replacement.
Establish and verify the baseline managed release before applying the feature release, then reload
the browser. No session-daemon restart is needed for this browser-only package.

`pucp rollback pi-hub --bundle openspec-status-web --to <verified-baseline-release>` becomes usable
only after that managed baseline exists. The release ID is determined then, not invented now.

Important: release bundles do not implement the delegated-M5 source anti-downgrade/expect-sha gates.
Current preparation relies on pinned hashes, committed provenance, inactive inventory and explicit
GO. Do not pretend those delegated flags enforce a browser-plugin release policy.

## Retention / cleanup

Preserve both development worktrees, all branches/PRs, package evidence, baseline/candidate payloads
and release history until approved release and rollback review. Do not remove locks by hand.
Review dirty/untracked data and references before any later cleanup; no cleanup is automatic here.
