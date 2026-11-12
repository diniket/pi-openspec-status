# Review follow-up — 2026-11-12 (second pass)

Base: `audit/final-hardening-20261112` @ `812176f`. No merge, no npm publication.

This pass started from an independent review of PR #5. Every finding below was re-checked
against the code before being changed; the CLI comparisons use a real
`@fission-ai/openspec@1.17.0`, the host comparisons use the real
`@jmfederico/pi-web@1.202611.1` installed on the agent host.

## Confirmed defects, fixed

| id | defect | fix |
|----|--------|-----|
| B1 | An unreadable auxiliary directory (`openspec/changes/archive`) made `_probe()` return `null`, so the panel showed "Update check failed" and stopped detecting external changes entirely. | `_probe()` now encodes each auxiliary listing in the fingerprint as readable names, `trunc` or `err`. Only an unreadable `openspec/changes` listing is a failed check. |
| B2 | The stale-data warning lived only in the stamp text, so any re-render (for example selecting a change) erased it while polling was still failing. | `#probeFailed` is state, rendered by `_renderStamp()` on every render. |
| B3 | After a failed probe followed by a successful manual refresh, the flag stayed set and the next successful probe started a second full reload. | The flag is cleared when a reload actually re-read the data. |
| B4 | One entry whose name is not a single path component turned the whole listing into an error: `OpenSpec read error` with no changes shown. | Such entries are skipped, the listing is marked truncated, and missing artifacts stay `unknown` instead of `absent`. A malformed response shape is still an error. |
| R1 | A scenario whose body is a fenced code block was reported as "no `#### Scenario:`", while the CLI accepts it (it only warns about missing WHEN/THEN steps). | Scenario *content* is checked on raw lines; section boundaries still use the fence-free view. |
| R2 | A `### Requirement:` outside a delta section was a blocking error; the CLI ignores it and reports a warning. | It is ignored and reported as a warning, no longer counted or validated. Requiring at least one requirement inside a delta is unchanged. |
| R3 | A `## Why` that only exists inside a fenced block made the change "structure!" while the CLI accepts it. | Proposal sections are located on raw text, exactly as the CLI's markdown parser does. The fence exclusion remains for spec files, where it prevents a false "structure ok". |

Additional fixes from the same review:

- **Probe generations** (`#probeSeq`): only the most recent probe writes `#fingerprint` or
  decides a reload. A slow probe could previously overwrite a newer fingerprint and cost one
  extra full reload.
- **Workspace switch**: `_clearRenderedState()` empties body, badge and error box and shows a
  loading placeholder, so a slow or never answering workspace cannot leave the previous
  workspace's list on screen.
- **Markdown nesting**: `renderMarkdown()` keeps recursing on blockquotes; beyond
  `MD_MAX_NESTING` (32) the remaining quote is rendered as plain paragraphs.
- **Polling cost**: the archive listing is probed only in the `no-active` state (the only
  state where the count is displayed).

## Regression tests

`npm test`: **128 passing, 0 failing, 0 skipped** (was 113 before this pass).

Of the added/updated tests, **16 fail against the previous source** (`812176f`), i.e. they
detect the behaviour that was fixed instead of merely describing the new code:
`malformed listings …`, `un archivio illeggibile …`, `la sonda distingue …`,
`una specs che non e' una directory …`, `l'avviso … sopravvive ai rerender`,
`un refresh manuale riuscito …`, `un nome di entry anomalo …`,
`un elenco incompleto …`, `cambio workspace con lettura lenta …`,
`una sonda superata non sovrascrive …`, `uno scenario con corpo in un blocco di codice …`,
`un ## Why dentro un blocco di codice …`, `la riga di validita' mostra gli avvisi …`,
`citazioni annidate molto profonde …`, `requirements outside delta sections are warnings …`,
`un elenco incompleto non trasforma un artefatto mancante in assente`.

## Comparison with the real OpenSpec CLI

Method: 24 synthetic changes plus 99 real active changes from eight repositories are copied
to a temporary directory; `openspec validate <id> --json` is the reference, and the plugin's
`inspectChangeValidity()` is fed the same files through the plugin's own read path
(`loadChangeDetail` + `loadDoc`).

- **Real corpus: 99/99 agree.** 279 change spec files, 3 690 scenarios.
- **Synthetic cases: 20/24 agree.** All four divergences are "plugin stricter than the CLI":

| case | plugin | `openspec validate` |
|------|--------|---------------------|
| requirement without SHALL/MUST (including lowercase `shall`) | invalid | valid by default, **invalid with `--strict`** (warning escalated) |
| `Why` shorter than 50 characters / only inside a fence | invalid | valid, no issue emitted |
| `proposal.md` missing | incomplete | valid (the CLI does not require it) |

No case exists where the plugin reports `structure ok` and the CLI rejects the change. The
SHALL/MUST severity matches `openspec validate --strict`; the `Why` length and the missing
proposal are deliberate extra checks of the panel ("artefatto non creato" is reported as
`incomplete`, not as a structural error). These three are documented in the README; they
were **not** changed in this pass because the fix list was limited to the review's
regressions and because dropping them would remove checks the panel's own tests and header
document on purpose.

Cases that now agree and previously did not: fenced requirement text (the plugin used to
report `valid`, the CLI rejects it), `REMOVED`/`RENAMED` deltas and `skip_specs` metadata
(deferred to the CLI), fenced-only spec files, empty scenarios, orphan requirements with a
valid delta, fenced scenario bodies, fenced `## Why`.

## Measurements

`listFiles` requests per probe (one probe per mounted panel every 60 s):

| workspace | per probe | per index read |
|-----------|-----------|----------------|
| 1 change / 3 capabilities | 6 (was 7) | 4 |
| `pi-agent-dashboard` (real tree, 40 displayed changes) | 172 | 78 |
| synthetic worst case, 40 changes × 12 capabilities | 561 (was 562) | 82 |

The remaining cost is the per-capability walk, which is what detects an edited `spec.md`
(a spec edit does not change the change directory listing). Capping it would make those
edits silently undetected, so no further bound was added.

## Host integration evidence

- The host's own catalog code (`dist/server/piWebPluginCatalog.js` of
  `@jmfederico/pi-web@1.202611.1`, the version installed on the agent host) discovers this
  package installed as a local plugin: id `openspec-status`, `browserRoot` `dist`,
  `browserModule` `dist/pi-web-plugin.js`, revision hash, `enabled: true`, **no
  diagnostics**. `readPiWebPluginPackageArtifact()` reads the bundle within the host limits.
- The host's loader predicate (`apiVersion === 5 && typeof name === "string" &&
  typeof activate === "function"`) matches the module's default export; contribution,
  navigation and file-response shapes match `dist/plugin-api.d.ts` (apiVersion 5) of the same
  version.
- **Not verified:** the panel running inside a live PI WEB browser session (no authorization
  to install the plugin into the instance that serves the current session), and the
  Playwright smoke script (no Chromium/Playwright on the agent host).

## Residual risks (unchanged or accepted)

- `_reload` has no timeout: a host request that never settles keeps `#pending` set and
  pauses both polling and refresh. The host API accepts an `AbortSignal`; the plugin does
  not use one (shared in-flight requests are reused by several consumers).
- Truncated change listings (more than 1 000 entries, host limit) still make unlisted
  artifacts `unknown`, so their documents are not shown.
- `openspec validate` semantics for `REMOVED`/`RENAMED` and `skip_specs` are still deferred:
  those changes show "?" instead of a verdict.
- Fences indented by four or more spaces (inside a list item) are still counted as task
  text, as before.
- The Markdown renderer still builds the whole document in one pass; nesting is bounded,
  but a multi-megabyte document is not streamed.
