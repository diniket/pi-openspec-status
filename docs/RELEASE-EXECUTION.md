# v0.2.0 execution — 2026-11-12

The user explicitly approved completing the previously reserved operations, including production
PUCP ownership adoption. This records results, not the earlier readiness-only snapshot.

## DONE — merges and version

- PR#5 https://github.com/diniket/pi-openspec-status/pull/5 -> main merge
  `0e49fd065df5f919f4064f1e30639e6e022cc262` (parents2b08bce and609c6bb).
- PR#6 https://github.com/diniket/pi-openspec-status/pull/6 retargeted to main after#5;
  feature-only diff checked, then merged as
  `06210b677ba7565b0dc4a36f3cdd8bca084b9282` (parents0e49fd0 and60d29d4).
- GitHub API confirms both closed/merged. All commits retained; no squash/rebase/force/deletion.
- Version/changelog release commit, pushed on main:
  **`b7d92d7b0fcdf281a7398f97ac93f83eaf43419a`**. package.json=0.2.0.
- Annotated local tagv0.2.0 points exactly at that release commit.
- Subsequent audit documentation commits are not part of the tagged package source.

## DONE — final validation and artifacts

178 tests pass, no failures/skips; build, src/dist equality, both module syntax checks, diff check,
pack allowlist, installed PiWeb1.202611.1 contract, OpenSpecCLI1.17.0 six reference cases and
three baseline regression proofs pass. Log `/tmp/pi-bg/156-bg13.log`.
Real Chromium155 synthetic-host harness17 assertions at390/1280 and broader real-shell GUI
on Cristina are in CONSOLIDATION.md; no claim that synthetic API tests are production integration.

Exact four-filev0.2.0 tarball:
`/tmp/openspec-v020-artifacts/candidate/pi-openspec-status-web-0.2.0.tgz`.
Retained also in canonical PUCP configs/openspec-status-web/artifacts/candidate/.

- SHA256: `f68f1a9f5796b4d3172654ee66fc4c370928178b574c769668c3a592b9ed0b79`
- npm integrity: `sha512-PcWZWV85MGqPbJHc0qsdluVwMFEhLVyIyVYUvfs2yRwUHBs0Y5GTsNikI1ID6z2lcd2kNQOy4G5EAmFnjT6SgA==`
- Module SHA256: `6857432a946e27c8487da97c6997d00614a20340b122148c2f7f4017068de226`
- Contents: LICENSE,README.md,package.json,dist/pi-web-plugin.js; no dependencies or private data.

## DONE — actual PUCP deployment and rollback

Canonical PUCP main incorporated the isolated preparation with a fast-forward; no remote is
configured. Authorized baseline activation commit7870ab4; final candidate pin commitd3c5e03.
Onlypi-hub enabled. Existing PUCP lock/immutable-release/current/hash/integrity/ownership/rollback
engine reused; no parallel deployment system or daemon restart.

1. Baseline609c6bb established first using specifically approved foreign-link adoption:
   `1794517603-34c3305d18-7870ab4274dc`.
2. Verifiedv0.2.0 normal apply:
   `1794517701-4feb742f6e-d3c5e033d9fc`.
3. Actual production rollback to baseline succeeded; filesystem AND revisioned HTTP module hash
   exactly `11ede8e7c1e565117f4a7764457ffab3747952ee060ed533dbf875926567607a`.
4. Normal reapply restoredv0.2.0, final active release:
   **`1794517730-4feb742f6e-d3c5e033d9fc`**, PUCP check ALLINEATO.

Production link now resolves through
`~/.pi-web/plugins/pi-openspec-status-web -> ~/.pucp/bundles/openspec-status-web/current/package`.
Production /api/plugins reports enabled/discovered/no conflict; actual revisioned HTTP bytes match
v0.2.0 module SHA above. Old Git checkout remains clean on609c6bb; other plugin destinations
unchanged, production web/daemon PIDs156/162 unchanged. All3 release directories retained.

Final package offline PUCP tests:2 dedicated +84 existing engine tests pass, log156-bg15.log.
Postdeploy real-shell smoke on Cristina uses synthetic projects with the **exact immutable active
release** as the isolated host's plugin source, not the development worktree. Contribution/list/
summary/tasks document and successful refresh restoring selected change/Tasks tab verified by
window-scoped screenshots. Actual production
HTTP/manifest verification remains separate; no private production conversations observed.

Verified rollback command:
```
./bin/pucp rollback pi-hub --bundle openspec-status-web --to 1794517603-34c3305d18-7870ab4274dc
```
Reload browser; no daemon restart. Source remainsv0.2.0 so rollback drift is expected until reapply.

## DONE — npm publication verified after user 2FA

Final measured state of `https://registry.npmjs.org/pi-openspec-status-web`:

- versions `0.0.0-stage`, `0.1.0`, **`0.2.0`**; `dist-tags.latest` = **0.2.0**
- `dist.integrity` = `sha512-PcWZWV85MGqPbJHc0qsdluVwMFEhLVyIyVYUvfs2yRwUHBs0Y5GTsNikI1ID6z2lcd2kNQOy4G5EAmFnjT6SgA==`
  (identical to the approved tarball), `dist.shasum` = `6832a304b63705a1f5c9d9c11b17a3bb0eac6066`
- maintainer `diniket`
- last CDN propagation of the package tarball was slow but completed: downloading
  `.../pi-openspec-status-web-0.2.0.tgz` now returns HTTP200 and its **SHA-256 is
  `f68f1a9f5796b4d3172654ee66fc4c370928178b574c769668c3a592b9ed0b79`**, byte-identical to the
  artifact built from release source `b7d92d7` and verified before upload.

Publication used the user's interactive 2FA on the normal npm web flow; Pi never received or
stored an OTP or token. The earlier misleading `+ pi-openspec-status-web@0.2.0` line is explained
by that delayed confirmation/propagation, not by a duplicate publication.

## DONE — annotated tag and GitHub release

The user ran the plain `git push origin v0.2.0` that Guardian refuses from Pi. Remote state:
annotated tag object `0aa30db0bea6817f40140675ddee92228655e41b` dereferences to commit
**`b7d92d7b0fcdf281a7398f97ac93f83eaf43419a`**, i.e. the exact release source.

GitHub release created through the authenticated browser on Cristina:
https://github.com/diniket/pi-openspec-status/releases/tag/v0.2.0 — name
"OpenSpec Status Web v0.2.0", not draft, not pre-release, marked Latest, notes generated from the
same evidence package (read-only scope, limits, npm name and checksums).

## HISTORICAL — earlier npm/tag blockers (all resolved)

Plain guarded `git push origin v0.2.0` was rejected before transport:
`push di ref non-branch non supportato da Guardian ... push di tag non supportato ... gestisci manualmente`.
No alternate executor, GitHub ref-creation API, guard change or force was attempted. At that check
the local annotated tag existed and the remote one did not; the user has since published it normally
(see the DONE section above). Never represent a main push as tag publication.

## HISTORICAL — npm publication blocker (resolved by the section above)

The legacy token in `~/.npmrc` was stale: `npm whoami` returned401, and an early publish attempt
was rejected with HTTP404 without publishing anything.

The user then completed `npm login --auth-type=web` on Cristina; `npm whoami` now returns `diniket`.
Two publish invocations of the verified tarball followed:

1. The first printed `+ pi-openspec-status-web@0.2.0` and a notice that the package was being
   processed. **This was misleading**: `https://registry.npmjs.org/pi-openspec-status-web`
   still lists only0.0.0-stage and0.1.0 (latest0.1.0), the version metadata and tarball URL return
   404, and no CDN propagation was observed after several minutes. Do not treat that line as proof.
2. A repeat publish of the identical tarball returned `EOTP - This operation requires a one-time
   password`, offering a browser approval URL. So npm still requires an interactive second factor
   for this write; the earlier apparent success did not create the version.

Conclusion (measured): **0.2.0 is NOT published.** Registry, version metadata, tarball URL and
dist-tags were all read back and disagree with the success line. Publication requires the user to
supply the current TOTP code (Bitwarden item `npm`) or approve the npm browser prompt while the
publish is running; Pi must not receive the code in chat and does not read tokens.

The verified artifact is unchanged and safe to publish when confirmation succeeds:
tarball SHA-256 `f68f1a9f…ed0b79`, integrity `sha512-PcWZWV85…T6SgA==`, module `6857432a…e226`.
After a successful publish, re-read `npm view pi-openspec-status-web@0.2.0 dist.integrity
dist.shasum`, the tarball URL and `dist-tags`, and compare against these values before reporting.

## HISTORICAL — npm authentication blocker (superseded by the section above)

Registry package maintainer isdiniket; initial npm whoami on bothpi-hub andCristina returned401.
A normal `npm login --auth-type=web` was started and its one-time CLI URL was opened on Cristina
only. No credentials were entered by Pi and no tokens were read/copied into chat, repositories or
another machine. The user did not complete the browser login within the validity window: the web
page returned `Invalid or Expired Token`, and the CLI process exited1 at the `Username:` prompt
after about5 minutes. This is an expired authentication attempt, **not** a rejected package or
permission decision. Publication is NOT claimed and registry still has latest0.1.0.
A second attempt used a **freshly generated** one-time URL, opened within about40 seconds in the
same Cristina window; npmjs.com again answered404 `Invalid or Expired Token`. Server date matched
local UTC clock, so clock skew is not the explanation. npmjs.com displayed an authenticated-looking
header in that browser, but this legacy `login/cli/<uuid>` flow did not grant the CLI a session.
No password/OTP was entered by Pi, no token was displayed, read or stored, and the login process
was stopped. Do not keep generating login links in a loop. The npm web flow is therefore
**not demonstrated working in this environment**; publication requires a human-run login with a
flow that actually succeeds (or an explicitly authorized client/credential path). Afterwards measure
npm whoami and owner rights, publish ONLY the verified tarball, then compare registry dist
integrity. Do not overwrite an existing0.2.0 version. GitHub release publication follows the
real remote tag, which remains blocked as described above.

## Retention and known limits

No branch,PR,worktree,backup or release deletion. Do not remove locks manually. Final immutable
package is independent of the old checkout. Read-only/local structural diagnostics and loaded-only
bounds remain as documented. Real-GUI fault injection and remote federation are not newly claimed.
