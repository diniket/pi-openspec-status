# Definitive consolidation — measured evidence, 2026-11-12

This is the retained pre-release review/evidence snapshot. The user subsequently approved
completion of merge/tag/npm/deploy operations; PR#5/#6 are now merged. See RELEASE.md and
RELEASE-EXECUTION.md (when present) for actual release/deployment results, not the historical
approval boundaries below.

## DONE — initial state, ancestry and protected delivery

Actual cwd: `/home/marco/Progetti/pi-openspec-workspace-experience`.
Initial feature HEAD34cd4fd, clean, based on609c6bb, three unpublished commits.
Origin is `git@github.com:diniket/pi-openspec-status.git`; SSH reports authenticated `diniket`.
No unrelated Git process/lock conflict was observed; no lock was removed.

Live checkout stayed on `audit/final-hardening-20261112` at
`609c6bbe9be7cf586e87e94e6718978ea411e037`; live symlink target was unchanged.
Production `/api/plugins` reports openspec-status enabled/discovered/no conflict; fetching its
revisioned asset matches original module SHA256
`11ede8e7c1e565117f4a7764457ffab3747952ee060ed533dbf875926567607a` (114951 bytes).
Hosting web/API and sessiond processes were not restarted or stopped.
The previously disclosed byte-identical live build/empty-directory deviation remains recorded
in WORKSPACE-EXPERIENCE.md; this continuation did not repeat it.

PR #5 API: open/draft/unmerged, head609c6bb, base main2b08bce;
**mergeable=true, rebaseable=true, mergeable_state=clean**, not a confirmed conflict.
Main is an ancestor of PR #5 and feature. Local `git merge-tree --write-tree` succeeds.
Therefore no conflict-resolution branch or PR #5 code rewrite was needed or performed.
The earlier reported mergeable=false is superseded by these measurements, not explained away
as a draft restriction. Draft/review approval remains a separate merge gate.

Plain `git push --set-upstream origin feature/openspec-workspace-experience` from the actual cwd
succeeded through Guardian. No -C/cd wrapper, alternate executor, force or guard bypass was used.
Code successors:0b7fd34 (runtime/metadata/defensive render fixes),9900fdd (shared probe fix).
Remote refs/final documentation HEAD are reported in the final session handoff.

## DONE — independent review and verified fixes

Fresh reviewer agent/model: deepseek-flash. All findings adjudicated in SECOND-REVIEW.md.
Confirmed fixes have regressions: >32-owned-workspace pruning, state-independent shared archive
probe and indented false metadata. Defensive control ordering/archive empty wording also fixed.
A subsequent independent correction check found no new confirmed plugin bug; its mistaken regex
claim was explicitly retracted after actual source/git-show verification. PUCP follow-up found
package-proof and inactive-inventory test gaps; tarballs and full archive/hash/payload verification
and a real inventory host-selection regression were added. No existing guard was weakened.

## DONE — tests, build, contracts, CLI, benchmarks

- Baseline609c6bb archived into a separate temporary test root: **128 pass,0 fail/skip** (~3.47s).
- Final source9900fdd: **178 pass,0 fail/skip** (~3.47s), all original128 retained.
- Build, byte-identical src/dist, source/dist/tooling/test syntax, diff whitespace check pass.
- npm pack dry-run: exactly LICENSE,README,package.json,dist module; zero bundled dependencies.
- Real installed host catalog/artifact/loader/signal contract: Pi Web **1.202611.1**, no diagnostics.
- Real OpenSpecCLI **1.17.0**, six synthetic cases: ADDED valid; empty scenario invalid;
  REMOVED/RENAMED/skip_specs deferred; missing proposal locally incomplete despite CLI passing.
- Regression proof: focus/hung-refresh release/host signal abort all fail on609c6bb, pass now.
- Dedicated Chromium155.0.8059.79 harness rerun at390/1280: **17 checks each**,0 errors,
 0 unhandled rejections,0 horizontal overflow. These remain synthetic host APIs, not the real shell.

Three iterations, median and min-max, synthetic5ms per host call:

| Shape | Calls unchanged | Baseline median(range)ms | New median(range)ms | Peak before/after |
|---|---:|---:|---:|---:|
|1 change/3 caps|6|30(30–31)|21(20–23)|1/3|
|40 changes/91 caps|172|872(871–873)|154(154–155)|1/6|
|40 changes/480 caps|561|2844(2840–2845)|482(482–483)|1/6|

Additional200ms-per-call new-source benchmark:6/172/561 calls; medians802/6007/19018ms,
ranges802–802/6006–6011/19017–19019; peaks3/6/6; no queue timeout. This refutes the review's
specific200ms cascade claim; it does not remove the documented15s queue-inclusive budget.
No production CPU/RSS/capacity claim is inferred from synthetic latency.

Logs retained by bg_run: initial verification `/tmp/pi-bg/156-bg1.log`, final full verification
`156-bg10.log`, slow benchmark `156-bg9.log`, PUCP initial proof `156-bg8.log`.

## DONE — REAL Pi Web shell GUI on explicitly authorized Cristina

`computer_use_status(host=cristina,deep=true)` verified Hyprland/Wayland, identity, input and
screenshot readiness. A **fresh Firefox window** was used; the existing PI WEB conversation
window and Thunderbird contents were not observed. AT-SPI exposed no Firefox nodes, so targeted
coordinate actions were followed by window-only screenshots. No fallback desktop was used.

Test instance: `/tmp/openspec-consolidation-lab`; separate config,data,agent profile,registry,
Unix socket and port18504, explicit installed SDK path, stripped inherited env/credentials,
offline flags. Only Synthetic Alpha/Beta fixture projects were registered; no sessions created.
Plugin link is under **isolated data/plugins only**, not the production plugin root.

Direct Cristina->10.0.0.109:18504 timed out. A loopback-only SSH reverse forward connected
Cristina127.0.0.1:18504 to the isolated server, without changing routing/firewall/live services.
This is actual Pi Web shell code, not a harness substituting host APIs.

Verified graphically through actual host APIs:
- project selection and OpenSpec contribution discovery/badge/rendering;
- loaded summary3, search `gamma` narrows to1 without changing summary; focus/caret retained;
- task viewer1/2, pending filter shows onlyg2; native archive selector also operated by keyboard;
- Open in Files selects exact tasks.md; returning to OpenSpec reloads then restores search,
 selected change, task tab and pending filter;
- explicit batch completes3/3 with1 incomplete/2 structural errors (fixtures deliberately simple);
- project switch immediately clears old data; Beta no-active count1, lazy archive browse1 change,
 archived proposal read and path correctly contain archive/;
- responsive Firefox viewport390px: controls wrap and remain usable, no observed horizontal
 plugin overflow; desktop window1268px also tested;
- task-count-unknown filter shows only Beta while summary remains3; descending-name order
 displays Gamma,Beta,Alpha when the filter is cleared;
- external synthetic task edit4/4->3/4 changes summary1 completed->0 without manual refresh
 or reload after that edit; visible update timestamp advances. This demonstrates real host
 automatic update, not isolated proof of whether watcher invalidation or polling fired first.
- latest module9900fdd served SHA256
 `6857432a946e27c8487da97c6997d00614a20340b122148c2f7f4017068de226` (140776bytes);
 page reload completed and panel rendered. During startup the host briefly showed
 “Workspace panel unavailable”; it resolved without intervention.

Screenshots are in the Computer Use tool evidence for this session, not copied into packages.
Firefox console: four bundled-plugin v4 deprecation warnings and one host security warning
about file:// links; **no observed OpenSpec error**. Isolated server log has a bundled GitAPIv3
warning; no plugin error found. Do not summarize this as “zero console messages.”

## READY / BLOCKED / NOT TESTED

**READY:** code/tests, independent-review adjudication, feature branch publication, exact sequential
merge plan and proposed changelog/release notes; immutable PUCP preparation and baseline rollback
proof. Package hashes/provenance live in the separate PUCP worktree; no final0.2.0 SHA exists yet.

**DONE — authentication blocker resolved by the user:** after explicit human login on Cristina,
created exactly one feature **draft PR#6**, https://github.com/diniket/pi-openspec-status/pull/6,
base audit/final-hardening-20261112 at609c6bb, initial head
22156e17bd6b9caba38afc7ae3a04756754e1294. API confirms open/draft/unmerged, mergeable=true,
mergeable_state=clean,6 feature commits and23 changed files. Body links the full review packet
at its immutable source SHA. No credentials/cookies extracted or tokens requested in chat.
Subsequent delivery-only documentation commits update the PR normally without rewriting history.
PR#5 remains unchanged/open/draft/unmerged; no branch/PR was deleted.

**READY — PUCP preparation:** isolated branch feature/openspec-plugin-release committed locally at
88fd36f59e0113fe2d9fcb9e04ba9d67960bc323, clean. No PUCP remote is configured, so no remote
publication is claimed. Final offline proof:2 dedicated tests plus84 existing tests pass,
log `/tmp/pi-bg/156-bg11.log`. Both tarballs are retained and fully hash/byte-verified; real
inventory hosts[] gating is tested. Candidate source22156e1 package SHA256
8543a064a6bbf2aa9abaf86734447fa196ff1139c60bca42c08d6bccb8e816a4;
rollback609c6bb package SHA256
a2b05e575fdea7dfe1de163441963e769b6f8952d81335e138a938bb311952b6.
These are preparation artifacts (version0.1.0), NOT the final0.2.0 package.

**DONE — process cleanup:** isolated web/daemon/tunnel stopped; port18504 no longer listening.
Production processes remain original PID156/162 and the served original module hash is unchanged.
Synthetic lab/artifact roots retained for audit; no branches/worktrees/backups/releases deleted.

**PENDING EXPLICIT APPROVAL:** PR#5 merge, feature retarget/review/merge, definitive main/version
commit, annotatedv0.2.0 tag, npm publication, PUCP host enablement/ownership adoption/deploy.
No merge/tag/npm publish/production link change has occurred.

**NOT TESTED in real GUI:** forced hung-transport/cancel/timeout faults, race stress with multiple
simultaneous panels, all accessibility assistive technologies and real remote-machine federation.
Those failure paths have Node/harness coverage, not equivalent real-shell fault-injection proof.
A GUI update alone cannot identify whether watcher invalidation or polling caused it first.
No private projects/transcripts were used to inflate integration coverage.

Conservative retention: keep branches, PRs, worktrees, rollback packages and evidence. No automatic
cleanup/deletion; inspect dirty/untracked data and references before any later cleanup proposal.
