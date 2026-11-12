# Consolidation handoff

See [measured report](CONSOLIDATION.md), [review adjudication](SECOND-REVIEW.md),
[release plan](RELEASE.md), [PUCP integration](PUCP-INTEGRATION.md).

- Actual worktree: `/home/marco/Progetti/pi-openspec-workspace-experience`, feature branch.
- Initial push34cd4fd succeeded via plain Guardian-protected push from this actual cwd.
- Reviewed corrective source9900fdd;178 Node tests pass, original128 retained.
- Real Pi Web1.202611.1 shell graphically tested on Cristina with synthetic isolated projects;
  separate Chromium155 harness17 checks at390/1280 also pass. Boundaries in report.
- PR#5 remains open/draft at609c6bb; API and local Git confirm no conflicts, mergeable clean.
- Feature draft must target audit/final-hardening-20261112 until approved PR#5 merge.
  Public duplicate check found no feature PR. Body:PR-WORKSPACE-EXPERIENCE.md.
- GitHub on Cristina showed Sign in: user authentication required to create draft PR.
  Do not extract cookies/tokens or ask for credentials in chat. Login only on https://github.com.
- PUCP separate worktree `/home/marco/Progetti/pi-unified-control-plane-openspec`,
  branch feature/openspec-plugin-release. Inactive release bundle hosts[], real package bytes,
  rollback609c6bb, existing engine reused; never enable/apply without production GO.
- Baseline/candidate tarball/module checksums are recorded in PUCP PROVENANCE.json; final0.2.0
  source/package/tag cannot exist before approved merges and version commit.
- Production original checkout/symlink/bytes remain609c6bb. No hosting daemon restart/stop.
- No merge, final tag, npm publication, production adoption/deployment or destructive cleanup.

If continuing: recheck final refs/clean trees; authenticate GitHub on Cristina, create one DRAFT
feature PR with correct stacked base, record actual URL/SHA. Never click merge without explicit
approval. Follow RELEASE.md for ancestry-preserving sequential merge operations and PUCP runbook
for separately approved baseline-first ownership transition. Preserve all evidence/artifacts.
