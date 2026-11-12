# Development

## Scope and layout

Browser-only, read-only Pi Web API v5 plugin. No runtime imports/dependencies, file writes,
CLI execution, LLMs or backend. One distributable ES module avoids unversioned relative imports
under Pi Web's revisioned plugin asset loader.

- `src/pi-web-plugin.js`: helpers, caches, request scheduler, parsers, Shadow DOM element, v5 contribution.
- `dist/pi-web-plugin.js`: byte-identical build copy; never edit directly.
- `test/run.js`: all 128 PR #5 regression tests, retained.
- `test/experience.js`: workspace-experience and lifecycle regressions.
- `test/dom-stub.js`, `test/fs-mock.js`: dependency-free Node harness.
- `fixtures/`: synthetic workspaces only; never copy private project content here.
- `scripts/benchmark.mjs`: synthetic transport benchmark, optionally against `609c6bb`.
- `scripts/browser-experience.js`: function executable inside real Chromium through CDP.
- `scripts/host-contract.mjs`: isolated discovery using an explicitly supplied installed Pi Web package.

```sh
npm test
npm run build
cmp src/pi-web-plugin.js dist/pi-web-plugin.js
node --check src/pi-web-plugin.js
git diff --check
npm pack --dry-run
node scripts/benchmark.mjs --baseline
npm run benchmark
# Supply a real installed package, never a production config/data directory:
node scripts/host-contract.mjs /path/to/node_modules/@jmfederico/pi-web
node scripts/cli-reference.mjs
node scripts/regression-proof.mjs
```

## Verified host contract

Re-inspected installed `@jmfederico/pi-web@1.202611.1`:

- Default export is an **object** `{apiVersion: 5, name, activate}`. Activation returns one
  `workspacePanels` contribution with badge, visibility, render and `workspace.files` invalidation.
- `WorkspaceFilesCapabilityV1` overloads readFile/listFiles with
  `WorkspaceFileRequestOptions {signal?: AbortSignal}`. No stat, recursive-list or pagination
  capability is exposed. The server's `fileTreeService.js` caps a single listing at **1,000 entries**.
- Entries carry name, type, size and modifiedAt; editing a child file does not reliably change
  its parent directory mtime. Never prune the capability walk using only directory mtime.
- Navigation keys must match `^[a-z][a-z0-9.-]*$`; values are contribution-scoped.
- The plugin uses `os-change`, `os-tab`, `os-spec`, `os-view`, `os-search`, `os-filter`, `os-sort`,
  `os-tasks`, all written with replace. Search is capped at 200 characters; enumerations are
  allowlisted. Invalid/stale selected names are not turned into filesystem paths.
- Open in Files uses navigate with `files:workspace.files` and `query.file`. Navigation Promise
  rejections are handled. No navigation API means the path is still shown without a dead button.
- Styling stays in each element's Shadow DOM, using inherited `--pi-*` tokens. A style in the
  document head would not cross the host's nested shadow roots.
- Package discovery/revisioning is read-only; an isolated package provider is enough to test it.
  A live install symlink follows its checkout: use a separate worktree for development.

A real browser with synthetic API responses verifies DOM behavior, **not** live shell integration.
The isolated catalog test executes the host's real discovery/artifact code without changing any
live plugin root or config. Additional real-shell tests now use Cristina's Firefox and an isolated
Pi Web instance with synthetic projects; see CONSOLIDATION.md for the exact coverage/limits.

## Safe real-shell lab

`scripts/isolated-host.mjs HOST_PACKAGE SDK_PACKAGE /tmp/openspec-<unique-root> web|sessiond`
launches only isolated processes, with explicit SDK path, empty separate agent profile, unique
config/data/socket and port18504. It intentionally strips inherited hosting-instance variables
and credentials; no production session/config/plugin roots are reused. Prepare synthetic projects
and a plugin symlink **under the isolated data root only**. Launch each role with bg_run, register
only synthetic projects via that instance, then test with Computer Use host `cristina`.
If direct LAN routing fails, a loopback-only SSH reverse forward may connect Cristina127.0.0.1:18504
to this isolated port; it does not modify firewall or production services. Stop all lab processes
and the tunnel after testing. Do not capture the user's existing PI WEB window/transcripts.

`node scripts/release-artifacts.mjs /tmp/openspec-<new-artifact-dir>` packages committed candidate
and pinned609c6bb rollback with an exact four-file allowlist. Retains tarballs, module/package hashes
and npm integrity for audit. No tag, publication, install or deployment occurs.

## Data model and scope

Both Active and Archive indexes load **at most 40** directory/symlink change names in deterministic
code-point order. No load-more fiction: unreturned entries cannot be reached through a nonexistent
pagination API. Partial listings and skipped malformed entries set `truncated`. Search/filter/sort
only transform index data in memory; the summary always uses the entire loaded index, not the
filtered subset. Scope text remains visible with no search results.

Tasks are parsed by **one parser**, `parseTaskItems`; `parseTaskGroups` projects away the items.
Index and viewer share cached document content. Only `##` groups and top-level `- [x]` / `- [ ]`
checkboxes count, outside fences. Known zero tasks is not a completed change. Unknown task counts
(missing, unreadable, binary or truncated) do not contribute zero tasks to supposedly global totals.
Open task totals are explicitly **known** totals. Task completion and structural conformity are
independent. The missing/unknown artifact filter includes optional artifacts, including Design.

The Tasks viewer filters parsed items locally and retains group headings/counts from the entire
readable content. Empty filtered groups have an explicit message. Truncated files show partial
counts with a warning. Sections are native details/summary; expansion identity contains collection,
change, group position/name and task text, excluding completion flags. Changed structure resets
incompatible expansion; unchanged structure preserves it across filters and refreshes.

Archive is loaded only by explicit mode selection or restoration of an archive navigation link.
The OpenSpec CLI archives a change directory under `changes/archive` (usually date-prefixed), but
we do not parse or require that naming convention. Documents use exactly the existing renderer
and read path, rooted at `openspec/changes/archive/<name>`; no restore/write action exists.
An absent archive and an empty archive are empty; unreadable or incomplete listings remain explicit.
Archive detail scans and index scans have the same bounds as active ones. Ordinary active polling
never walks archived changes. The historical no-active directory-count probe is retained.

## Caches, identity and invalidation

Keys encode `[machine.id, workspace.id]` as JSON (not a colon-concatenated string). Partial contexts
have an object-identity key; internal read-context copies retain it through a private Symbol.
Index keys also distinguish archive; detail/document/validation keys include relative paths.

| Cache | TTL | completed-entry bound |
|---|---:|---:|
| Index | 30 s | 16 workspaces/collections |
| Detail / document / local structural result | 60 s | 256 each |

All completed entries age out after 10 minutes. In-flight entries survive pruning. Index task reads
use 30s document freshness, not the longer viewer TTL. Concurrent index/detail/document loads
coalesce. Refresh deletes workspace cache generations; obsolete responses cannot repopulate the
current generation. Structural results are published only while their detail generation still
matches. Multiple panels invalidated together join one fresh index generation. A TTL-driven index refresh
also discards old child-cache generations/diagnostics and reloads a selected document, rather than
showing old content underneath a fresh index timestamp.

The same workspace with a new host context object remains the same data source, including during
refresh. A new workspace/machine clears list, badge, documents, diagnostics, UI preferences and
restoration state immediately. Async generation, view, selection, detail and document guards reject
obsolete callbacks. Read results after unmount cannot update DOM.

## Requests and cancellation

Central `REQUEST_LIMITS`:

- 15s request budget, **including queue time**; queue timeout has a separate message.
- 60s operation deadline for index/detail/validation/probe scans (subsequent calls fail immediately).
- Six active host requests per workspace, shared by all panels/probes/diagnostics.
- Two batch change workers. Index workers and probe branches use bounded concurrency too.

Every call receives an AbortSignal. The scheduler handles synchronous throws, rejected Promises,
malformed responses, hung hosts and late resolve/reject. Completion, cancellation and timeout clear
the request timer and free the slot exactly once. Abort-ignoring hosts cannot hold the plugin's
Promise/busy flag forever; their own transport may remain alive, outside plugin control. The six-call
bound is on scheduler-live requests, not on abandoned transports in a broken host.

A workspace runtime tracks mounted owners. Unmounting/switching one owner does not cancel a request
another mounted owner can still need. Leaving the last owner aborts active/queued requests, closes
that runtime and clears caches. Already started work uses its captured runtime/deadline, so cannot
restart abandoned scans on a fresh runtime. Completed unused runtimes are pruned.

Stop checks is **cooperative**: it invalidates the batch generation immediately, schedules no more
changes and stops subsequent validation-document reads. A currently shared detail/read is allowed
to settle within its timeout/deadline. It is deliberately not aborted on behalf of just the batch;
physical per-consumer abort without refcounting would break another panel's read. Refresh/workspace
switch invalidates the result set. Progress counts finished changes, not files; incomplete/stopped
batches are never reported as a complete scan. Errors in async batch rendering are caught and the
running state is released.

## Structural diagnostics

`inspectChangeValidity` remains a limited local check, compared with the real OpenSpec CLI on
synthetic fixtures. States:

- `valid` (UI **structure ok** / local pass): the supported local checks pass, **not** full validation.
- `incomplete`: expected local artifacts not yet created (including proposal/deltas).
- `invalid`: supported local checks found malformed content.
- `unverified`: incomplete listings/reads, unsupported metadata/schema, REMOVED/RENAMED or skip_specs.

Selected-change checks remain automatic on selection. Batch checks start only on click, use the
same caches and inspectors, and list every finished result with a direct document-navigation
button. Main specs, cross-file conflicts and custom schema semantics are not checked. Why length
and missing proposal checks are deliberately stricter than default CLI behavior; uppercase
SHALL/MUST corresponds to strict rather than default CLI severity. Historical audit reports document
these differences; do not relabel a local pass as validated.

## Polling and UI stability

Visible, mounted active panels probe every 60s. Concurrent periodic probes for the same workspace
coalesce; probe generations still prevent a stale fingerprint overwriting a newer explicit refresh.
All loaded changes/capabilities remain covered, including spec file size/mtime. Signatures and
bounded subsets are sorted consistently with index/detail selection. Auxiliary listing errors and
truncation are represented in fingerprints. Top-level read failure leaves a stale warning and applies
bounded backoff (1–4 intervals); manual refresh bypasses it, and changing collection resets it.

Parallelism improves latency without hiding changes; request count is deliberately unchanged.
Directory-mtime shortcuts, reduced coverage, recursive host API calls and archive walks in normal
polling were rejected as unsafe or unsupported. No claim of lower total request count is made.

Controls live outside the replaceable list, so typing cannot replace the search input. State-identity
checks skip unchanged host renders. Targeted document updates and guarded UI snapshots preserve
stable focus keys/IDs, caret, native details and scroll ancestors. Scroll intent survives a temporary
loading layout that clamps scrollTop; an intervening user scroll wins. Deferred focus restoration
expires after five seconds, does not steal focus from a newly focused external element, and Stop
falls back to the Check button. Workspace/view changes discard restoration state.

No innerHTML/eval/HTML injection; Markdown is built from text/DOM nodes, external links are HTTP(S)
only with noopener/noreferrer, images never fetch. Roving document tabs support arrows/Home/End;
controls have accessible labels and visible focus; task symbols are not editable controls.
