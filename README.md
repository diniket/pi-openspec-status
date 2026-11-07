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

From the directory where you want to clone the project:

```bash
git clone https://github.com/diniket/pi-openspec-status.git
mkdir -p ~/.pi-web/plugins
ln -s "$(pwd)/pi-openspec-status" ~/.pi-web/plugins/pi-openspec-status
```

Reload PI WEB and select the **OpenSpec** tab in a workspace.

The built plugin is already included in `dist/`; you do not need to install dependencies or build it to use it.

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

Per installazione e comandi usa le istruzioni sopra. Il controllo strutturale **non sostituisce** `openspec validate`.
