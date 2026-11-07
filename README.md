# pi-openspec-status

OpenSpec status in PI WEB. It adds an **`OpenSpec` tab to the workspace panel** — the tab
strip at the top of the workspace column, next to Files, Git, Terminal, Tasks and Relays.
Pick a workspace and see what is open, which artifacts exist, and how far the task list got.
Read-only: no CLI, no model, no writes.

## What it does

- **Change list** — one compact card per active change: proposal / design / specs / tasks
  state (colored, `absent` dashed), progress bar, task count (`7 / 14 (50%)`).
- **Click a change** and its details open under the list: `Proposal`, `Design`, `Specs` and
  `Tasks` tabs, with the markdown rendered inside the panel. `Specs` lists up to 12 spec files per change
  and lets you switch between them (larger sets are marked truncated). Absent documents, documents that fail to read and
  empty spec folders are three different states, each with its own message.
- **Tasks** are parsed from the real `tasks.md`: sections, `[x]`/`[ ]` items, per-section
  counts and overall percentage. Read-only, no checkbox can be changed.
- **Refresh** — a button in the header reloads everything for the workspace; the panel also
  refreshes itself when the host reports changed files, and — while the tab is visible —
  checks once a minute whether the OpenSpec files changed underneath (terminal, editor, Pi)
  and reloads only if they did. Selection, open tab and document survive the refresh. The
  header shows when the data was read, so stale data is never passed off as current.
- **Open in Files** — every document has a button that opens it in the Files panel, and coming
  back to the `OpenSpec` tab restores the change, the tab and the document you were reading.
- **Structure check** — next to the progress, a discreet badge (`structure ok` /
  `incomplete` / `structure!`) for the selected change, with the reasons one click away. It
  reproduces the *structural* rules of `openspec validate` (headings, deltas, SHALL/MUST,
  scenarios) from the files the panel reads — it is not a full CLI run. It appears only for
  changes actually checked, and task progress is never used to guess it. When spec files
  are unreadable, truncated or only partly enumerated, the result stays unverified.
- **Reads only** the workspace through the host `files` API. No workspace files are written and no CLI command is run; the plugin
  itself sends no data directly to third-party services.

## Install

```bash
git clone https://github.com/diniket/pi-openspec-status.git
mkdir -p ~/.pi-web/plugins
ln -s "$PWD/pi-openspec-status" ~/.pi-web/plugins/pi-openspec-status
```

Reload the PI WEB page. Requirements: PI WEB 1.202611.0 (plugin API v5), an OpenSpec
project in the workspace (`openspec/changes/`). No dependencies and no build step: `dist/`
is committed and byte-identical to `src/`.

## Known Pi Web limitation

On PI WEB 1.202611.0, opening a saved URL containing `tool=openspec-status:openspec-status` may display `Workspace panel unavailable` during host route restoration. Open the project without this parameter and click **OpenSpec** instead. This is a host startup issue, not an OpenSpec read error.

## Development

```bash
node --test test/run.js     # regression suite, no dependencies
node scripts/build.mjs      # copy src -> dist after editing
```

`docs/DEVELOPMENT.md` has the layout and the host-API notes; `docs/REVIEW-2026-11-07.md`
has the external review with its findings and their status.

What the plugin shows is OpenSpec data only. Two things were dropped on purpose: the label on
session rows (a `sessionLabels` render item reaches the row as an empty placeholder in this
host version, and leaves a dangling `·`) and the four counters that used to sit above the
card — "Automations" read `.pi-web/tasks.json`, which is the workspace-tasks file, not the
scheduled automations; "Goals" counted relay packets; "MCP" read `.pi/mcp.json`, a path Pi
never uses (its servers live in `~/.config/mcp/mcp.json`, `~/.pi/agent/mcp.json` or a project
`.mcp.json`). None of them was OpenSpec data, and in practice all showed `—`.

## How it was made

The code was **written by Halogen Qwen3.8 Flash Next**, then **debugged, reviewed and fixed
by DeepSeek Flash (Pi agent)**: layout, Shadow DOM styling, cache/refresh guards, error
handling, tests.

The local model ran on the **BOSGAME M5** (AMD Ryzen AI Max+ 395, Radeon 8060S, 128 GB),
which runs **Ubuntu 26.04.1**. The plugin was assembled, run and verified on an Arch Linux
workstation (Ryzen 7 9700X + Radeon RX 9060 XT) with PI WEB 1.202611.0, and checked in the
real browser in both the light and the dark theme.

---

# pi-openspec-status (Italiano)

Stato di OpenSpec in PI WEB. Aggiunge una **scheda `OpenSpec` al pannello workspace** — la
striscia di schede in alto nella colonna workspace, accanto a Files, Git, Terminal, Tasks e
Relays. Scegli un workspace e vedi cosa è aperto, quali artefatti esistono e a che punto sono
i task. Solo lettura: nessuna CLI, nessun modello, nessuna scrittura.

## Cosa fa

- **Elenco change** — una card compatta per change attiva: stato di proposal / design / specs
  / tasks (colorato, `absent` tratteggiato), barra di avanzamento, conteggio task
  (`7 / 14 (50%)`).
- **Clic su una change** e il dettaglio si apre sotto l'elenco: schede `Proposal`, `Design`,
  `Specs` e `Tasks`, con il markdown reso dentro il pannello. `Specs` elenca fino a 12 file spec per change
  e permette di passare dall'uno all'altro (gli elenchi più grandi sono segnalati come troncati). Documento assente, documento
  illeggibile e cartella specs vuota sono tre stati diversi, ognuno con il suo messaggio.
- **Task** letti dal vero `tasks.md`: sezioni, voci `[x]`/`[ ]`, conteggi per sezione e
  percentuale complessiva. Solo lettura, nessuna casella modificabile.
- **Refresh** — un pulsante nell'intestazione ricarica tutto il workspace; il pannello si
  aggiorna anche quando l'host segnala file cambiati e — mentre la scheda è visibile —
  controlla una volta al minuto se i file OpenSpec sono cambiati da fuori (terminale, editor,
  Pi) e ricarica solo in quel caso. Selezione, scheda aperta e documento sopravvivono al
  refresh. L'intestazione mostra a che ora i dati sono stati letti, così un dato vecchio non
  passa per aggiornato.
- **Open in Files** — ogni documento ha un pulsante che lo apre nel pannello Files, e tornando
  alla scheda `OpenSpec` si ritrovano la change, la scheda e il documento che si stavano
  leggendo.
- **Controllo strutturale** — accanto all'avanzamento, un badge discreto (`structure ok` /
  `incomplete` / `structure!`) per la change selezionata, con i motivi a un clic. Riproduce le
  regole *strutturali* di `openspec validate` (sezioni, deltas, SHALL/MUST, scenari) sui file
  che il pannello legge: non è un'esecuzione completa del CLI. Compare solo per le change
  davvero controllate e l'avanzamento dei task non viene mai usato per dedurlo. Se le spec
  sono illeggibili, troncate o elencate parzialmente, l'esito resta non verificabile.
- **Legge soltanto** il workspace tramite l'API `files` dell'host. Non modifica i file del workspace e non esegue comandi CLI; il plugin
  non invia direttamente dati a servizi di terze parti.

## Installazione

```bash
git clone https://github.com/diniket/pi-openspec-status.git
mkdir -p ~/.pi-web/plugins
ln -s "$PWD/pi-openspec-status" ~/.pi-web/plugins/pi-openspec-status
```

Ricarica la pagina di PI WEB. Requisiti: PI WEB 1.202611.0 (plugin API v5) e un progetto
OpenSpec nel workspace (`openspec/changes/`). Nessuna dipendenza e nessun build: `dist/` è
versionato ed è byte-identico a `src/`.

## Limite noto di Pi Web

Su PI WEB 1.202611.0, un URL salvato con `tool=openspec-status:openspec-status` può mostrare `Workspace panel unavailable` durante il ripristino della rotta dell'host. Apri il progetto senza questo parametro e seleziona **OpenSpec**. È un problema di avvio dell'host, non di lettura OpenSpec.

## Sviluppo

```bash
node --test test/run.js     # suite di regressione, nessuna dipendenza
node scripts/build.mjs      # copia src -> dist dopo una modifica
```

`docs/DEVELOPMENT.md` descrive la struttura e le API dell'host; `docs/REVIEW-2026-11-07.md`
contiene la review esterna con i finding e il loro stato.

Il pannello mostra solo dati OpenSpec. Due cose sono state tolte apposta: l'etichetta sulle
righe delle sessioni (un item `sessionLabels` di tipo render arriva alla riga come segnaposto
vuoto in questa versione dell'host e lascia un `·` appeso) e i quattro contatori che stavano
sopra la card — "Automations" leggeva `.pi-web/tasks.json`, che è il file del plugin
workspace-tasks, non le automazioni schedulate; "Goals" contava i pacchetti relay; "MCP"
leggeva `.pi/mcp.json`, un path che Pi non usa (i suoi server stanno in
`~/.config/mcp/mcp.json`, `~/.pi/agent/mcp.json` o in un `.mcp.json` di progetto). Nessuno dei
tre era un dato OpenSpec e in pratica mostravano tutti `—`.

## Com'è nato

Il codice è stato **scritto da Halogen Qwen3.8 Flash Next**, poi **debuggato, riletto e
corretto da DeepSeek Flash (Pi agent)**: impaginazione, stili nello Shadow DOM, guardie di
cache e refresh, gestione errori, test.

Il modello locale girava sul **BOSGAME M5** (AMD Ryzen AI Max+ 395, Radeon 8060S, 128 GB),
che usa **Ubuntu 26.04.1**. Il plugin è stato assemblato, eseguito e verificato su una
workstation Arch Linux (Ryzen 7 9700X + Radeon RX 9060 XT) con PI WEB 1.202611.0, e
controllato nel browser reale sia in tema chiaro sia in tema scuro.
