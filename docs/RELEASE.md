# v0.2.0 release — approval-gated procedure

## Current anchors

- main: `2b08bcefacee0a4ce8cb29bf4ad31d2fb226d3e6`.
- PR #5: https://github.com/diniket/pi-openspec-status/pull/5
  head `609c6bbe9be7cf586e87e94e6718978ea411e037`, open/draft/unmerged.
- Feature: `feature/openspec-workspace-experience`, initially published `34cd4fd`;
  see CONSOLIDATION.md and remote refs for successors. Base is PR #5, not main.
- GitHub API now reports PR #5 mergeable=true, mergeable_state=clean. Local merge-tree
  succeeds and main is an ancestor. Earlier mergeable=false is not a current conflict.

## Sequential operations (NOT executed)

Require explicit approval of the merge operations and re-read remote refs/checks first.
Keep merge commits (no squash/rebase) to preserve ancestry of the stacked feature branch.

1. Review PR #5 at exactly `609c6bbe9be7cf586e87e94e6718978ea411e037`.
   Update its outdated evidence/checklist with current host proof. Mark ready only after review.
2. Merge PR #5 -> main, recording the actual merge SHA M1. Verify
   `git merge-base --is-ancestor 609c6bb origin/main` after fetch. If this fails, STOP.
3. Retarget the feature draft PR from `audit/final-hardening-20261112` to main.
   Check the diff is feature-only, review the final feature SHA, and run the complete suite again.
4. Merge feature -> main with a merge commit; record actual SHA M2. Verify both
   609c6bb and the reviewed feature SHA are ancestors of M2. Do not delete branches/worktrees.
5. Only now create a release branch/worktree from updated main, set package version to 0.2.0,
   date the changelog, and commit. Final main/version commit requires the approved merge/release
   process; no final SHA is available beforehand.
6. Run `npm test`, build, byte comparison, syntax/diff checks, host contract, CLI reference,
   baseline regression proof, pack inspection, isolated shell GUI checks and PUCP offline proof.
7. `npm pack --json` in that release worktree; list contents and compute SHA-256 and npm integrity.
   Reject unexpected files, dependencies, node_modules, sessions, credentials or temporary data.
   Record tarball SHA, module SHA, full source commit and host/CLI versions in release notes.
8. After explicit tag approval: annotated `git tag -a v0.2.0 <release-sha> -m 'v0.2.0'`,
   inspect the tag, then a plain guarded tag push. Never force or retag an existing release.
9. After explicit npm approval and authenticated account/name ownership check:
   `npm publish <verified-tarball> --access public`. Check npm dist integrity against the
   approved artifact. Create GitHub release notes from CHANGELOG plus compatibility/limits.
10. Production deployment is a separate GO through PUCP, never an npm side effect.

## Package availability

Measured registry response: `pi-openspec-status-web` exists; latest 0.1.0; versions
0.0.0-stage and 0.1.0. 0.2.0 is absent. Existing package availability does not prove that
this session has npm publication rights. No npm login/token has been read or requested.

## Release note template

Use CHANGELOG.md's unreleased section, actual PR URLs/merge/source SHAs, exact tarball checksum,
compatibility versions and remaining integration limitations. A local structural pass is not
`openspec validate`; search/summary are loaded-only; Stop is cooperative; transport cancellation
requires host cooperation. Do not invent the final release commit or checksum in advance.
