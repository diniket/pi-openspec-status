# pi-openspec-status

A small, read-only **OpenSpec panel for PI WEB**. It adds an **OpenSpec** tab to the workspace view, so you can check what is in progress without opening every Markdown file.

## What you get

- **Active changes:** see Proposal, Design, Specs and Tasks at a glance, including task counts and progress bars.
- **Document viewer:** read the Markdown files for a change, browse its specs and see tasks grouped by section.
- **Updates:** refresh manually, react to file changes reported by PI WEB, or check for edits made in an external editor or terminal every 60 seconds while the panel is active.
- **Navigation:** open a document in PI WEB's Files tab and return to the same change and document.
- **Quick structure check:** a small badge flags missing or malformed OpenSpec artifacts. This is **not** a replacement for `openspec validate`; files that cannot be fully read are marked unverified.

The plugin only reads workspace files through PI WEB's file API. It does not modify projects, run the OpenSpec CLI or require a model or runtime dependencies.

## Install

Tested with **PI WEB 1.202611.0** (plugin API v5). The workspace needs an `openspec/changes/` directory.

**From npm** (recommended). In PI WEB open **Settings → Pi packages**, enter
`npm:pi-openspec-status-web` and choose **Install**. Then open **Settings → PI WEB plugins**,
make sure the plugin is enabled, and reload the browser page. It is a browser-only plugin,
so no session-daemon restart is needed. From a terminal on the same machine the equivalent is
`pi install npm:pi-openspec-status-web`.

**From a GitHub checkout** (alternative), from the directory where you want to clone it:

```bash
git clone https://github.com/diniket/pi-openspec-status.git
mkdir -p ~/.pi-web/plugins
ln -s "$(pwd)/pi-openspec-status" ~/.pi-web/plugins/pi-openspec-status
```

Reload PI WEB and select the **OpenSpec** tab in a workspace.

The built plugin is already included in `dist/`, in the npm tarball as well as in the
repository; you do not need to install dependencies or build it to use it. The package is
tagged `pi-web.dev-plugin`, `pi-web-plugin` and `pi-package`, so it is listed in the
[PI WEB community plugins directory](https://pi-web.dev/community-plugins).

## Notes

- The panel shows up to **40 active changes** and **12 spec files per selected change**; larger lists are marked as truncated.
- The structure badge is only a quick check of the files the panel can read. For full validation, use the OpenSpec CLI.
- In PI WEB 1.202611.0, opening a bookmarked URL containing `tool=openspec-status:openspec-status` can show **Workspace panel unavailable** during startup. Opening the workspace first and clicking **OpenSpec** works around this host-side issue.

## Development

```bash
npm test            # Node regression tests
npm run build       # copy src/pi-web-plugin.js to dist/
```

The source is in `src/pi-web-plugin.js`; `dist/pi-web-plugin.js` must stay identical. See [development notes](docs/DEVELOPMENT.md) for internals.

MIT licensed. See [LICENSE](LICENSE).

---

### Italiano

Plugin di sola lettura per visualizzare le change OpenSpec direttamente in PI WEB: stato degli artefatti, avanzamento dei task, documenti Markdown e controllo strutturale di base. Rileva anche le modifiche fatte da terminale o editor esterni, senza modificare i file del progetto.

Per installazione e comandi usa le istruzioni sopra: pacchetto npm `pi-openspec-status-web` da
**Impostazioni → Pi packages**, oppure il symlink da un checkout GitHub. Il controllo strutturale **non sostituisce** `openspec validate`.

### Hardening notes

Directory/file responses that cannot be verified are reported as unknown or read errors.
Truncated task documents explicitly label their partial totals. A failed background check
marks the displayed data as potentially stale, keeps that warning visible across re-renders,
and retries on the next polling interval. An auxiliary directory that cannot be listed
(`archive`, `specs/`, a capability folder) marks that part of the change fingerprint as
unreadable instead of disabling the check; only an unreadable `openspec/changes` listing
counts as a failed check. Workspace switches clear the rendered panel immediately, so data
from the previous workspace is never displayed while the new listing loads.

Anomalous directory entries (names that are not a single path component, missing type) are
skipped instead of hiding the whole folder, and the listing is then reported as incomplete:
what could not be listed stays **unknown** and never becomes **absent**.

The local structure check handles proposal sections and ADDED/MODIFIED requirement
blocks outside fenced examples. REMOVED/RENAMED deltas and `skip_specs` metadata are
reported as **unverified**: use the OpenSpec CLI for their full semantics. It does not
check existing main specs, schema-specific artifacts, or cross-file conflicts.

Alignment with the OpenSpec CLI (verified against `openspec validate` 1.17.0 on 99 real
changes in eight repositories, all agreeing): a scenario whose body is a fenced code block
is content, requirements outside a delta section are **warnings** (the CLI ignores them),
and proposal sections are located textually as the CLI does. The check remains stricter
than default `openspec validate` where the CLI only warns: a missing SHALL/MUST is an
error (like `openspec validate --strict`), and a `Why` section shorter than 50 characters
or a missing `proposal.md` are reported as well. Those are the only known divergences and
they never make an invalid change look valid.

An optional real-browser smoke check is available as `python scripts/browser-smoke.py`
with Python Playwright and `/usr/bin/chromium` installed. It serves the checkout locally,
uses synthetic fixture data through a host API harness, and writes a screenshot to
`/tmp/openspec-browser-mobile.png`. This is separate from testing inside PI WEB itself.
