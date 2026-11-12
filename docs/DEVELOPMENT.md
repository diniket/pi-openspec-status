# Development notes

Everything you need to change this plugin without rediscovering the same things twice.

## Layout

```
src/pi-web-plugin.js    the whole plugin, one file, no imports
dist/pi-web-plugin.js   byte-identical copy of src, this is what PI WEB serves
scripts/build.mjs       copies src -> dist, nothing else
test/run.js             96 test definitions (86 baseline + 10 regressions)
test/dom-stub.js        minimal DOM (elements, shadow roots, querySelector)
test/fs-mock.js         in-memory workspace file API + context factory
fixtures/               on-disk sample workspaces, read by createFsFromDir()
```

There is no bundler and no dependency. The file must stay loadable as a bare ES module in
a browser, which is why there are no imports and no build step beyond copying.

## Commands

```bash
node --test test/run.js      # run the suite
node scripts/build.mjs       # regenerate dist/ after editing src
```

Always edit `src/`, never `dist/`, and run `node scripts/build.mjs` after each source edit.
The existing test suite checks byte-for-byte equality of `src/` and `dist/`.

## The host API, and what it does not give you

These are the constraints that shaped the code. They are all verified against PI WEB
1.202611.0 (`dist/plugin-api.d.ts` in the installed package), not guessed.

**The default export must be an object.** `{ apiVersion: 5, name: string, activate }`.
Exporting the activate function directly is rejected by the host **silently** — no error
in the console, the plugin just never appears.

**Shadow DOM is required for styling.** PI WEB mounts panel content inside nested shadow
roots (`pi-web-app > workspace-panel > ... > panel render`). A `<style>` appended to
`document.head` does not reach those nodes: the rules exist but none apply, which looks
exactly like "the plugin loaded but everything is unstyled and piled up in the corner".
`ensureShadow()` gives each element its own shadow root with its own `<style>`. Theme
custom properties (`--pi-*`) do cross the shadow boundary, so theming still works.
The host does offer styling hooks — the `stylesheet-integration` capability (a capability
token, `registerRoot(root, { sharedUi })`, declarable via `requires`) and
`contributions.stylesheets` (an external CSS URL) — but this plugin deliberately stays
self-contained: one JS file, no extra asset to serve, styles owned per element.

**`workspaceLabels` is not where you think it is.** The client renders workspace labels
only in the rows of the **WORKSPACES** section (`renderWorkspaceMain`). The **PROJECTS**
row is name + path with no label slot at all, and many layouts never render the
workspaces section. If you add a `workspaceLabels` contribution, verify it is actually
visible in the UI you use before building anything on it.

**Missing file and unreadable file look identical.** `files.listFiles(path)` rejects the
same way for both. That is why `doLoad()` probes `openspec/` first and then
`openspec/changes/`: two probes distinguish "not an OpenSpec project" from "could not read
the project", instead of parsing error strings.

**Cache-busting and when a reload is enough.** The plugin revision is a hash over the whole
package directory, recomputed on every `/api/plugins` call. The browser always requests
the module with `?v=<revision>`, and the server reloads from disk when that revision
differs from what it has cached. So after editing `dist/`, a **page reload is enough** —
no PI WEB restart. (A request *without* `?v=` can return stale bytes from the server's
in-memory artifact cache; that is a testing artefact, not a bug you need to work around.)

**Badge callbacks are synchronous.** `badge(context)` must return from the cache
synchronously; it cannot trigger a fetch. So the badge is empty until the panel itself has
loaded once. That is by design, not a bug.

## Caching model

Caches, all keyed `machine.id:workspace.id` (documents also by path):

| cache | holds | TTL |
| --- | --- | --- |
| `cache` | the panel's OpenSpec state (list + task counts) | 30 s (`ACTIVE_TTL_MS`) |
| `detailCache` | artifacts + spec file list of one change | 60 s (`DETAIL_TTL_MS`) |
| `docCache` | the text of one document | 60 s (`DETAIL_TTL_MS`) |

Rules that matter:

- Entries still in flight have `loadedAt === 0` and must **never** be pruned; pruning
  filters on `loadedAt > 0` for that reason.
- Concurrent calls coalesce onto the in-flight promise.
- It is pruned to `CACHE_MAX_ENTRIES` (16); earlier variants had no pruning at all and grew
  one entry per workspace visited, which was a real leak.

**Session-row labels do not render.** A `sessionLabels` contribution whose item is
`{ type: "render", render: () => html`<my-element>` }` reaches the row as an **empty
`<lit$…$>` placeholder** in this host version (verified in the running UI, in the app's own
shadow root), and because the item exists the host also draws its `·` separator, so every
session row ends with a dangling dot. The contribution was removed for that reason. Anything
that needs to reach a session row has to come from a mechanism the host actually renders.
- `setActiveTtlMs()` exists as a test seam. ESM exports are not assignable from outside,
  so tests cannot set the constant directly.

## Bounds

`INDEX_MAX_CHANGES = 40` and `MAX_SPEC_FILES = 12` are independent limits. Each change costs up to three reads
(directory, `specs/`, `tasks.md`), so without a cap a workspace with hundreds of changes
turns the first render into hundreds of requests. The active-change cap sets `state.truncated`, reported in the timestamp header. The spec-file
cap is separate, and incomplete spec listings cannot yield `structure ok`.

## Testing approach

There is no browser in the test suite.

- `test/dom-stub.js` implements just enough DOM: `createElement`, `createElementNS`,
  `attachShadow`, `querySelector` for `#id` / `.class` / tag / descendant, `textContent`,
  `hidden`, `className`. It is installed as globals **before** the plugin is imported,
  because the element classes extend `HTMLElement` at import time.
- `test/fs-mock.js` builds a fake `files` API from a `tree` map plus `contents`, and can
  be told to reject paths (`rejectPaths`) or report truncation (`truncatedReads`) to
  exercise error paths. `createFsFromDir()` loads a real fixture directory instead.
- `createContext(fs, workspaceId)` returns a context shaped like the host's.

When you add behaviour, add a test that would fail without it. Several tests exist purely
to pin a fix: the cache-pruning tests count file calls rather than inspecting internals,
so they fail loudly if pruning is removed.

## Conventions

- No dependencies, no imports, no build step beyond the copy.
- Never write to the workspace. This plugin is read-only; that is a product guarantee, not
  a style preference.
- Keep "absent" and "unknown" distinct end to end. Absent means the file is not there;
  unknown means a read failed. Collapsing them hides real faults.
- Keep user-visible strings in English, matching PI WEB's own chrome.
- Fixtures must stay synthetic. At least one fixture was previously a byte-identical copy
  of a real private project file; it was replaced with a synthetic one that preserves the
  same shape (6 groups, 7/14 tasks, checkboxes inside code fences). Do not drop real
  project files into `fixtures/`.

**Only OpenSpec data is shown.** The panel used to carry four counters above the change card
(Automations, Goals, MCP, OpenSpec). Sources checked against the real features: the workspace
tasks file is `.pi-web/tasks.json` (the *workspace-tasks* plugin, not the scheduled
automations, which live in SQLite), relays do live under `.pi-web/relays/` with `charter.md`
as an anchor document, but MCP servers are **not** in `.pi/mcp.json` — Pi reads
`~/.config/mcp/mcp.json`, `~/.pi/agent/mcp.json` or a project `.mcp.json`. None of the three
was OpenSpec, so the whole row was removed together with its cache and helpers.

## Dashboard data flow

Selecting a change loads its *detail* (one listing of the change directory plus one listing
per spec capability, capped at `MAX_SPEC_FILES`). Document text is fetched only when its tab
is opened, through `loadDoc`, and cached by path. `clearWorkspaceCaches()` drops all three
caches for a workspace, and both the header button and the host invalidation path go through
it before reloading — that is why the panel can show `Loading…` instead of the previous
content, and never old text dressed up as fresh.

Absence and read failure are separate states: the directory listing says whether a document
exists, so `proposal.md` missing is `absent` while a failing read of an existing file is
`error`. `loadDoc` therefore only ever returns `ok` / `truncated` / `binary` / `error`.

Markdown is rendered by `renderMarkdown()` in this file: a small block parser (headings,
paragraphs, nested lists with task checkboxes, fenced code, quotes, GFM tables, rules) plus an
inline pass for code, bold, italic and http(s) links. It only builds DOM nodes with
`textContent` — no `innerHTML`, no dependency, no sanitizer needed; `javascript:` and other
schemes never become links.

`Open in Files` navigates with the host API the Files plugin itself uses: `navigate` with
`tool: "files:workspace.files"` and the query key `file`, mode `patch`. Missing that API (or
an older host) leaves the path visible in the panel and does nothing else.

Accessibility: the tabs are a real `tablist` (roving `tabindex`, `aria-selected`,
`aria-controls`, arrow/Home/End keys), the change card is a `button` with
`aria-expanded`/`aria-controls`, the progress bar exposes `role="progressbar"`, and every
interactive element has a `:focus-visible` outline.

## External changes, panel navigation, validation

While mounted and visible the panel runs one `setInterval` (`EXTERNAL_CHECK_MS`, 60 s). It only
reads directory listings (name, size, mtime) for the active changes and their spec folders and
compares a fingerprint: identical fingerprint means no request and no render. A different one
calls the same `_reload` as the header button, which keeps selection, tab and document. Timers
are cleared in `disconnectedCallback`, the check is skipped when the document is hidden and a
second check cannot overlap the first (`#probing`). Host `workspace.files` invalidations remain
the primary mechanism; the timer covers edits made outside Pi Web, which the host does not
report.

Selection survives a tool switch through `context.navigation` (contribution-scoped query):
`os-change`, `os-tab`, `os-spec` are written with `replace: true` and read back when the panel
mounts. Keys must match the host's `^[a-z][a-z0-9.-]*$` rule: PI WEB 1.202611.0 rejects
anything else (`Invalid contribution navigation key`) and the panel swallows the error, so a
camelCase key silently disables persistence — the value ends up in the address bar as
`openspec-status.openspec-status--os-change`. The test DOM stub enforces the same rule.
Nothing is stored on disk, and the state is per workspace because the navigation object
is. A change that no longer exists clears the key instead of restoring stale state.

In-flight loads compare `machine` + `workspace` (`sameWorkspaceContext`), not the identity of
the context object: the host builds a new object on every render, and an identity check
discarded perfectly good responses, leaving the detail or the document on `Loading…`
forever. The anti-contamination guarantee is unchanged — a different workspace still cannot
write over the panel.

`inspectChangeValidity()` mirrors the *structural* rules of `openspec validate` 1.15.0 that can
be checked from the files the panel already reads (the badge says `structure ok`, never
"valid", because a full CLI run also validates the main specs and is not performed here): `## Why` (≥ 50 characters), `## What Changes`, at least
one delta with a `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` header, at least one
`### Requirement:` block per spec file, each requirement with
SHALL/MUST and at least one `#### Scenario:`. Too-long requirement text is treated as a warning,
like the CLI does. Missing artifacts are `incomplete`, non-conforming artifacts are `invalid`,
and anything not readable is `unverified` — never a guess. It runs once per selected change
(one or two extra reads, cached with `DETAIL_TTL_MS`), not on every render.

## Regression checks added after review

The test suite includes seven review regressions: malformed Markdown fences, a refresh
pending across a workspace switch, a new context object for the same workspace, unreadable
spec directories, truncated spec files, orphan Scenario blocks without any Requirement,
and numbered Markdown lists. These run in the Node DOM harness.

Three further regressions came out of the graphical verification on the running host: the
navigation keys (the stub rejects any key the host would reject, so persistence cannot
silently break again) and two "context object replaced while loading" cases, one for the
change detail and one for the document, which used to leave the panel on `Loading…` until
the user clicked again.

PI WEB itself may not restore a deep link with `tool=openspec-status:openspec-status` during
initial plugin activation. This issue is in the host route restore logic; open the project
and select the OpenSpec tab as a workaround. No host patch is part of this plugin.

## Final hardening (2026-11-12)

See [audit and validation evidence](AUDIT-2026-11-12.md). The task summary parser now
projects `parseTaskItems()` instead of maintaining a second scanner. Task content is shared
between the index and document viewer; index reads retain their shorter 30-second freshness
window. Forced UI refresh removes the index entry as well as child caches, so in-flight
responses cannot become the refreshed cache generation. Obsolete validation results are
not written back after their detail cache generation is removed.

Document/detail/validation caches now prune completed entries after ten minutes or when
over 256 entries (in-flight entries are preserved). The index remains capped at 16 completed
workspace entries. Spec traversal is capped at 12 capability folders as well as 12 documents;
incomplete listings must not be presented as proof of absence or structural validity.

Directory entry names must be single path components. The host still owns workspace and
symlink containment; this plugin has no direct filesystem access. It does not resolve
worktrees separately: the host-selected workspace supplies the root, and cache keys include
both machine and workspace identity.
