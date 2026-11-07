// ============================================================================
// pi-openspec-status-web — PI WEB browser plugin (v5), browser-only
// ----------------------------------------------------------------------------
// Pannello informativo OpenSpec per la colonna workspace di PI WEB.
//
// - Legge SOLO file del workspace selezionato via l'host API `files`
//   (WorkspaceFiles.listFiles / readFile, read-only; nessuna CLI, nessun LLM).
// - Nessuna dipendenza runtime, nessun import: file autonomo servibile come
//   ES module dal gateway PI WEB.
// - Cache per workspace (16 entry / 10 min) con coalescing dei fetch in
//   flight e TTL 30 s; refresh su onInvalidate (host) e su cambio workspace.
// - Stato per artefatto: present / absent / unknown (lettura non riuscita).
//
// API usate (verificate su PI WEB 1.202611.0, dist/plugin-api.d.ts):
//   - workspacePanels: { id, title, icon, order, badge, visible,
//     onInvalidate, invalidationResources, render }
//   - render(context) => TemplateResult, context: WorkspacePanelContextV5
//     (machine, workspace, state, files, host, ...)
//   - files.listFiles(path[, {signal}]) -> { entries, scannedAt, truncated }
//   - files.readFile(path[, {signal}])  -> { content, encoding, size,
//     modifiedAt, truncated, binary }
//
// Mappa del file (un solo modulo: il loader di PI WEB serve il modulo con
// ?v=<revision>, gli import relativi no — vedi docs/DEVELOPMENT.md):
//   1. costanti e cache del pannello        ~20-120
//   2. stili (PANEL_CSS)                    ~50-400
//   3. parser dei task (parseTaskItems)     sezione "Task: gruppi"
//   4. renderer Markdown (renderMarkdown)   sezione "Markdown minimale"
//   5. dettaglio change + documenti         detailCache / docCache / loadDoc
//   6. stato del pannello (loadOpenSpecState)
//   7. elemento del pannello                class OpenspecPanelElement
//   8. entry del plugin (activate)          in fondo
// ============================================================================

const CHANGES_DIR = "openspec/changes";
const ARCHIVE_DIR = "archive";
const INDEX_MAX_CHANGES = 40;

// Refresh period quando i dati possono cambiare fuori sessione (editor, CLI
// openspec): il host non espone file-watching; le scritte in-session sono
// coperte da onInvalidate (host, immediato).
const ACTIVE_TTL_MS_DEFAULT = 30_000;
// Distanza minima fra due refresh forzati dall'invalidazione del host.
const FORCE_MIN_INTERVAL_MS = 1_000;

// Controllo leggero delle modifiche esterne (terminale, editor, Pi) mentre il
// pannello e' montato e visibile. Non e' polling del contenuto: legge solo gli
// elenchi con nome/dimensione/mtime e ricarica unicamente se l'impronta cambia.
const EXTERNAL_CHECK_MS = 60_000;

// Chiavi di navigazione del pannello (contribution-scoped, per workspace):
// servono a ripristinare selezione, scheda e file di spec dopo un cambio tool.
const NAV_CHANGE = "osChange";
const NAV_TAB = "osTab";
const NAV_SPEC = "osSpec";

// Regole di validazione OpenSpec 1.15.0 (dist/core/validation/constants.js)
// riprodotte in sola lettura sui file letti dal pannello.
const MIN_WHY_LENGTH = 50;
const MAX_REQUIREMENT_TEXT = 500;
const DELTA_HEADER = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i;
const REQUIREMENT_HEADER = /^###\s+Requirement:\s*(.*)$/;
const SCENARIO_HEADER = /^####\s+Scenario:\s*(.*)$/;

// TTL interno mutabile; seam get/set per i test (gli export ESM non sono
// assegnabili dall'esterno, quindi il test non puo' fare plugin.ACTIVE_TTL_MS=).
let ACTIVE_TTL_MS = ACTIVE_TTL_MS_DEFAULT;
export function setActiveTtlMs(ms) { ACTIVE_TTL_MS = ms; }
export function getActiveTtlMs() { return ACTIVE_TTL_MS; }

// Pruning cache: età max e numero max di entry (una per workspace).
const CACHE_MAX_AGE_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 16;

const PANEL_TAG = "openspec-status-panel";

// ───────────────────────────────────────────────────────────────────────────
// Stili e Shadow DOM.
//
// PI WEB 1.202611.0 monta il contenuto dei pannelli dentro shadow root
// annidati (pi-web-app > workspace-panel > ... > render del pannello): uno
// <style> appeso a document.head NON raggiunge quegli elementi. Era la causa
// del pannello "testi e icone accatastati in alto a sinistra": le regole
// esistevano, ma nessuna si applicava.
//
// L'host offre due strade per gli stili: la capability "stylesheet-integration"
// (registerRoot con eventuale sharedUi, dichiarabile in `requires`) e le
// `contributions.stylesheets` (foglio esterno per URL). Entrambe vogliono un
// asset esterno o un root registrato dall'host.
// Scelta deliberata: restare autonomi — ogni custom element crea il proprio
// shadow root e ci mette dentro il proprio <style>. Il plugin resta un singolo
// file ES senza asset da servire; le custom property del tema (--pi-*)
// attraversano il confine dello shadow root, quindi colori e font restano
// quelli di PI WEB.
// ───────────────────────────────────────────────────────────────────────────
const STYLE_ATTR = "data-openspec-styles";

const PANEL_CSS = `
:host {
  display: block;
  min-width: 0;
  color: var(--pi-text);
  font-family: var(--pi-control-font-family, system-ui, sans-serif);
  font-size: 12px;
  line-height: 1.45;
}
*, *::before, *::after { box-sizing: border-box; }

/* ── intestazione ──────────────────────────────────────────────────────── */
.os-header { display: flex; align-items: center; gap: 8px; margin: 0 0 14px; min-width: 0; }
.os-header-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto; width: 22px; height: 22px; border-radius: 6px;
  background: var(--pi-purple-surface, var(--pi-surface-hover));
  color: var(--pi-accent);
}
.os-title { font-size: 13px; font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
.os-badge {
  flex: 0 0 auto; min-width: 18px; padding: 1px 7px; border-radius: 999px;
  background: var(--pi-accent); color: var(--pi-bg, #fff);
  font-size: 11px; font-weight: 600; line-height: 1.5; text-align: center;
  font-variant-numeric: tabular-nums;
}
.os-badge[hidden] { display: none; }

/* ── riepilogo change ──────────────────────────────────────────────────── */
.os-section {
  margin: 16px 0 6px; font-size: 9px; font-weight: 600;
  letter-spacing: .1em; text-transform: uppercase; color: var(--pi-muted);
}
.os-section:first-child { margin-top: 0; }
.body { display: flex; flex-direction: column; min-width: 0; }

.change {
  display: flex; flex-direction: column; gap: 8px;
  padding: 11px 0; border-bottom: 1px solid var(--pi-border-muted); min-width: 0;
}
.change:last-of-type { border-bottom: 0; }
.change--focus {
  gap: 10px; padding: 12px 14px; margin-bottom: 4px;
  border: 1px solid var(--pi-border-muted); border-radius: 12px;
  background: var(--pi-surface);
}
.os-change-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.name {
  flex: 1 1 auto; min-width: 0;
  font-family: var(--pi-control-monospace-font-family, ui-monospace, monospace);
  font-size: 12px; font-weight: 600; color: var(--pi-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.change--focus .name { font-size: 13px; white-space: normal; word-break: break-word; }
.os-status {
  flex: 0 0 auto; padding: 1px 8px; border: 1px solid var(--pi-border-muted);
  border-radius: 999px; font-size: 10px; letter-spacing: .04em;
  text-transform: uppercase; color: var(--pi-muted); white-space: nowrap;
}
.os-status--complete { color: var(--pi-success); border-color: var(--pi-success-border); background: var(--pi-success-surface); }
.os-status--partial { color: var(--pi-accent); border-color: var(--pi-accent-border); background: var(--pi-purple-surface); }
.os-status--none { color: var(--pi-warning); border-color: var(--pi-warning-border); background: var(--pi-warning-surface); }

/* ── progress bar ──────────────────────────────────────────────────────── */
.os-progress {
  position: relative; height: 6px; width: 100%; overflow: hidden;
  border-radius: 999px; background: var(--pi-border-muted);
}
.os-progress--empty { opacity: .45; }
.os-progress-fill { height: 100%; border-radius: 999px; background: var(--pi-accent); }
.os-progress-fill--complete { background: var(--pi-success); }

/* ── fasi OpenSpec ─────────────────────────────────────────────────────── */
.artifacts { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.artifact {
  padding: 2px 8px; border: 1px solid var(--pi-border-muted); border-radius: 8px;
  font-size: 11px; color: var(--pi-muted); white-space: nowrap;
}
.artifact--present { color: var(--pi-success); border-color: var(--pi-success-border); background: var(--pi-success-surface); }
.artifact--unknown { color: var(--pi-warning); border-color: var(--pi-warning-border); background: var(--pi-warning-surface); }
.artifact--absent { color: var(--pi-dim, var(--pi-muted)); border-style: dashed; }

/* ── metriche e conteggi ───────────────────────────────────────────────── */
.os-metrics { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--pi-muted); }
.tasks { white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--pi-text); font-size: 11px; }
.change--focus .tasks { font-size: 12px; }

/* ── stati vuoti / errore / footer ─────────────────────────────────────── */
.empty { margin: 6px 0; color: var(--pi-muted); font-size: 12px; }
.error { margin: 8px 0 0; color: var(--pi-danger); font-size: 11px; }
.error-state { margin: 6px 0; color: var(--pi-danger); }
.change-error { color: var(--pi-danger); font-size: 11px; }
.stamp { font-size: 10px; color: var(--pi-muted); }

/* ── intestazione: timestamp e refresh ───────────────────────────────── */
.os-stamp { flex: 0 0 auto; font-size: 10px; color: var(--pi-muted); font-variant-numeric: tabular-nums; }
.os-refresh {
  flex: 0 0 auto; width: 22px; height: 22px; padding: 0; border-radius: 6px;
  border: 1px solid var(--pi-border-muted); background: transparent;
  color: var(--pi-muted); font: inherit; font-size: 13px; line-height: 1;
  cursor: pointer;
}
.os-refresh:hover { color: var(--pi-text); border-color: var(--pi-border); background: var(--pi-surface-hover); }
.os-refresh:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
.os-refresh[disabled] { opacity: .55; cursor: progress; }
.os-refresh--busy { animation: os-spin 900ms linear infinite; }
@keyframes os-spin { to { transform: rotate(360deg); } }

/* ── elenco change selezionabile ─────────────────────────────────────── */
.change--selected { background: var(--pi-purple-surface); border-radius: 10px; padding-left: 8px; padding-right: 8px; }
.os-change-toggle {
  display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;
  padding: 0; border: 0; background: transparent; color: inherit; font: inherit;
  text-align: start; cursor: pointer;
}
.os-change-toggle:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; border-radius: 6px; }

/* ── dettaglio ───────────────────────────────────────────────────────── */
.os-detail { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; min-width: 0; }
.os-hint, .os-muted { margin: 8px 0 0; font-size: 11px; color: var(--pi-muted); }
.os-empty { margin: 8px 0 0; font-size: 12px; color: var(--pi-muted); }

.os-tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--pi-border-muted); padding-bottom: 6px; }
.os-tab {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: var(--pi-muted); font: inherit; font-size: 11px;
  cursor: pointer; white-space: nowrap;
}
.os-tab:hover { color: var(--pi-text); background: var(--pi-surface-hover); }
.os-tab[aria-selected="true"] {
  color: var(--pi-accent); background: var(--pi-purple-surface);
  border-color: var(--pi-accent-border); font-weight: 600;
}
.os-tab:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
.os-tab--muted { opacity: .72; }
.os-tab-count {
  padding: 0 5px; border-radius: 999px; background: var(--pi-surface-hover);
  font-size: 10px; font-variant-numeric: tabular-nums; color: var(--pi-muted);
}
.os-tab[aria-selected="true"] .os-tab-count { background: var(--pi-bg); color: var(--pi-accent); }
.os-tab-state { font-size: 10px; color: var(--pi-warning); }

.os-tabpanel { min-width: 0; outline: none; }
.os-tabpanel:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; border-radius: 8px; }

/* ── markdown ────────────────────────────────────────────────────────── */
.os-doc { min-width: 0; font-size: 12px; line-height: 1.5; color: var(--pi-text); overflow-wrap: anywhere; }
.os-doc > :first-child { margin-top: 6px; }
.os-doc h3, .os-doc h4, .os-doc h5, .os-doc h6 { margin: 12px 0 4px; line-height: 1.3; color: var(--pi-text); }
.os-doc h3 { font-size: 13px; }
.os-doc h4 { font-size: 12px; }
.os-doc h5, .os-doc h6 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--pi-muted); }
.os-doc p { margin: 6px 0; }
.os-doc ul, .os-doc ol { margin: 6px 0; padding-left: 18px; }
.os-doc li { margin: 2px 0; }
.os-doc li > ul, .os-doc li > ol { margin: 2px 0; }
.os-doc code {
  padding: 1px 4px; border-radius: 4px; background: var(--pi-surface-hover);
  font-family: var(--pi-control-monospace-font-family, ui-monospace, monospace); font-size: 11px;
}
.os-doc pre.os-code {
  margin: 8px 0; padding: 8px 10px; overflow-x: auto; max-width: 100%;
  border: 1px solid var(--pi-border-muted); border-radius: 8px; background: var(--pi-bg);
}
.os-doc pre.os-code code { padding: 0; background: transparent; font-size: 11px; line-height: 1.45; }
.os-doc blockquote {
  margin: 8px 0; padding: 2px 10px; border-left: 3px solid var(--pi-border);
  color: var(--pi-muted);
}
.os-doc hr { margin: 12px 0; border: 0; border-top: 1px solid var(--pi-border-muted); }
.os-doc a { color: var(--pi-accent); }
.os-doc .os-check { margin-right: 5px; color: var(--pi-success); }
.os-table { border-collapse: collapse; margin: 8px 0; font-size: 11px; display: block; overflow-x: auto; }
.os-table th, .os-table td { padding: 3px 8px; border: 1px solid var(--pi-border-muted); text-align: start; }
.os-table th { background: var(--pi-surface-hover); font-weight: 600; }

/* ── task ────────────────────────────────────────────────────────────── */
.os-task-summary { margin: 8px 1px 4px; font-size: 11px; color: var(--pi-muted); }
.os-task-summary b { font-size: 12px; color: var(--pi-text); font-variant-numeric: tabular-nums; }
.os-task-groups { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
.os-task-group-head {
  display: flex; align-items: baseline; gap: 8px; margin: 0 0 4px;
  font-size: 11px; font-weight: 600; color: var(--pi-text); letter-spacing: .02em;
}
.os-task-list { margin: 0; padding-left: 2px; list-style: none; }
.os-task { display: flex; align-items: flex-start; gap: 6px; margin: 3px 0; font-size: 11px; color: var(--pi-text); }
.os-task .os-check { flex: 0 0 auto; color: var(--pi-muted); }
.os-task--done { color: var(--pi-muted); }
.os-task--done .os-check { color: var(--pi-success); }
.os-task--done .os-task-text { text-decoration: line-through; }
.os-task-text { min-width: 0; overflow-wrap: anywhere; }

/* ── specs ───────────────────────────────────────────────────────────── */
.os-spec-nav { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 2px; }
.os-spec {
  padding: 2px 8px; border: 1px solid var(--pi-border-muted); border-radius: 8px;
  background: transparent; color: var(--pi-muted); font: inherit; font-size: 10px;
  cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.os-spec:hover { color: var(--pi-text); background: var(--pi-surface-hover); }
.os-spec--on { color: var(--pi-accent); border-color: var(--pi-accent-border); background: var(--pi-purple-surface); }
.os-spec:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }

/* ── validità OpenSpec ───────────────────────────────────────────────── */
.os-validity {
  flex: 0 0 auto; padding: 0 6px; border-radius: 999px; font-size: 9px;
  letter-spacing: .04em; text-transform: uppercase; white-space: nowrap;
  border: 1px solid var(--pi-border-muted); color: var(--pi-muted);
}
.os-validity--valid { color: var(--pi-success); border-color: var(--pi-success-border); background: var(--pi-success-surface); }
.os-validity--incomplete { color: var(--pi-warning); border-color: var(--pi-warning-border); background: var(--pi-warning-surface); }
.os-validity--invalid { color: var(--pi-danger); border-color: var(--pi-danger); }
.os-validity-box { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 6px 0 2px; min-width: 0; }
.os-validity-details { font-size: 10px; color: var(--pi-muted); min-width: 0; }
.os-validity-details summary { cursor: pointer; }
.os-validity-details ul { margin: 4px 0 0 14px; padding: 0; }
.os-validity-details li { margin: 2px 0; overflow-wrap: anywhere; }

/* ── azioni documento ────────────────────────────────────────────────── */
.os-doc-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--pi-border-muted); }
.os-doc-path {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--pi-control-monospace-font-family, ui-monospace, monospace);
  font-size: 10px; color: var(--pi-muted);
}
.os-open-file {
  flex: 0 0 auto; padding: 2px 8px; border: 1px solid var(--pi-border-muted); border-radius: 8px;
  background: transparent; color: var(--pi-accent); font: inherit; font-size: 10px; cursor: pointer;
}
.os-open-file:hover { background: var(--pi-surface-hover); border-color: var(--pi-accent-border); }
.os-open-file:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }

@media (prefers-reduced-motion: reduce) {
  .os-refresh--busy { animation: none; }
}
`;

// Crea (una sola volta) lo shadow root con il foglio di stile dell'elemento.
function ensureShadow(el, css, kind) {
  if (el.shadowRoot !== null && el.shadowRoot !== undefined) return el.shadowRoot;
  if (typeof el.attachShadow !== "function") return el; // senza Shadow DOM: degrada a light DOM
  let root;
  try {
    root = el.attachShadow({ mode: "open" });
  } catch {
    return el; // root gia' esistente (anche closed): degrada a light DOM, niente eccezione dal setter
  }
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTR, kind);
  style.textContent = css;
  root.append(style);
  return root;
}

// Svuota uno shadow root lasciando il foglio di stile.
function clearShadow(root) {
  for (const child of Array.from(root.children || [])) {
    if (typeof child.getAttribute === "function" && child.getAttribute(STYLE_ATTR) !== null) continue;
    child.remove();
  }
}

// Testo del conteggio task, formato storico "7 / 14 (50%)".
function taskText(tasks) {
  if (!tasks || tasks.known !== true) return null;
  const pct = tasks.total > 0 ? ` (${Math.round((100 * tasks.completed) / tasks.total)}%)` : "";
  return `${tasks.completed} / ${tasks.total}` + pct;
}

// Stato sintetico del change derivato dai task (per il pill di riepilogo).
function changeStatus(tasks) {
  if (!tasks || tasks.known !== true) return { key: "unknown", label: "tasks n/a" };
  if (tasks.total === 0) return { key: "none", label: "no tasks" };
  if (tasks.completed >= tasks.total) return { key: "complete", label: "complete" };
  if (tasks.completed === 0) return { key: "none", label: "not started" };
  return { key: "partial", label: "in progress" };
}

// ───────────────────────────────────────────────────────────────────────────
// Task: gruppi con le singole voci.
// Stessa semantica del conteggio storico (heading "## ", checkbox "- [x]"/"- [ ]",
// contenuti nei blocchi di codice ignorati) ma con il testo di ogni voce, che
// serve alla vista raggruppata.
// ───────────────────────────────────────────────────────────────────────────
export function parseTaskItems(content) {
  try {
    if (typeof content !== "string") return [];
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const n = lines.length;
    const isHeading = new Array(n).fill(false);
    const isFenceLine = new Array(n).fill(false);
    let inFence = false;
    let fenceChar = "";
    for (let i = 0; i < n; i++) {
      const line = lines[i];
      const fence = line.match(/^(`{3,}|~{3,})/);
      if (inFence) {
        isFenceLine[i] = true;
        if (fence !== null && fence[1][0] === fenceChar[0] && fence[1].length >= fenceChar.length) inFence = false;
      } else if (fence !== null) {
        isFenceLine[i] = true;
        inFence = true;
        fenceChar = fence[1];
      } else if (/^##\s/.test(line)) {
        isHeading[i] = true;
      }
    }
    const headingIndices = [];
    for (let i = 0; i < n; i++) if (isHeading[i]) headingIndices.push(i);
    if (headingIndices.length === 0) return [];
    const groups = [];
    for (let g = 0; g < headingIndices.length; g++) {
      const startLine = headingIndices[g];
      const endLine = g + 1 < headingIndices.length ? headingIndices[g + 1] : n;
      const items = [];
      for (let i = startLine + 1; i < endLine; i++) {
        if (isFenceLine[i]) continue;
        const line = lines[i];
        const done = /^- \[x\]/i.test(line);
        const pending = !done && /^- \[ \]/.test(line);
        if (!done && !pending) continue;
        items.push({ text: line.replace(/^- \[[ xX]\]\s?/, "").trim(), done });
      }
      const completed = items.filter(it => it.done).length;
      groups.push({
        name: lines[startLine].replace(/^##\s+/, "").trim(),
        completed,
        total: items.length,
        status: taskGroupStatus(completed, items.length),
        items,
      });
    }
    return groups;
  } catch {
    return [];
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Markdown minimale, costruito solo con nodi DOM (mai innerHTML): intestazioni,
// paragrafi, liste annidate (incluse le checkbox di task), blocchi di codice,
// citazioni, righe orizzontali, tabelle GFM e inline (code/grassetto/corsivo/link).
// I link diventano <a> solo per http/https; tutto il resto resta testo.
// ───────────────────────────────────────────────────────────────────────────
const MD_INLINE = /(!\[[^\]\n]*\]\((?:https?:\/\/)?[^)\s]*\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>()]+)/g;
const MD_LINK = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/;

function mdInline(text) {
  const frag = document.createDocumentFragment();
  const src = String(text ?? "");
  let last = 0;
  for (const m of src.matchAll(MD_INLINE)) {
    if (m.index > last) frag.append(document.createTextNode(src.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith("![")) {
      // immagine: nessun <img> (niente fetch esterni dal pannello), testo com'e'
      frag.append(document.createTextNode(tok));
    } else if (tok.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = tok.slice(1, -1);
      frag.append(code);
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      const strong = document.createElement("strong");
      strong.append(mdInline(tok.slice(2, -2)));
      frag.append(strong);
    } else if (tok.startsWith("[")) {
      const mm = MD_LINK.exec(tok);
      if (mm === null) {
        frag.append(document.createTextNode(tok));
      } else {
        const a = document.createElement("a");
        a.setAttribute("href", mm[2]);
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
        a.textContent = mm[1];
        frag.append(a);
      }
    } else if (tok.startsWith("http")) {
      const a = document.createElement("a");
      a.setAttribute("href", tok);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      a.textContent = tok;
      frag.append(a);
    } else {
      const em = document.createElement("em");
      em.append(mdInline(tok.slice(1, -1)));
      frag.append(em);
    }
    last = m.index + tok.length;
  }
  if (last < src.length) frag.append(document.createTextNode(src.slice(last)));
  return frag;
}

const MD_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const MD_TASK = /^\[([ xX])\]\s?([\s\S]*)$/;

function mdList(items) {
  const root = document.createElement("ul");
  const stack = [{ indent: items[0].indent, list: root }];
  let lastItem = null;
  for (const it of items) {
    while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) stack.pop();
    let top = stack[stack.length - 1];
    if (it.indent > top.indent && lastItem !== null) {
      const nested = document.createElement(it.ordered ? "ol" : "ul");
      lastItem.append(nested);
      top = { indent: it.indent, list: nested };
      stack.push(top);
    }
    const li = document.createElement("li");
    const task = MD_TASK.exec(it.text);
    if (task !== null) {
      const box = document.createElement("span");
      box.className = "os-check";
      box.setAttribute("aria-hidden", "true");
      box.textContent = task[1].toLowerCase() === "x" ? "\u2611" : "\u2610";
      li.append(box, mdInline(task[2]));
    } else {
      li.append(mdInline(it.text));
    }
    top.list.append(li);
    lastItem = li;
  }
  return root;
}

function mdTable(header, rows) {
  const table = document.createElement("table");
  table.className = "os-table";
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  for (const cell of header) {
    const th = document.createElement("th");
    th.append(mdInline(cell));
    hrow.append(th);
  }
  thead.append(hrow);
  table.append(thead);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.append(mdInline(cell));
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

const mdCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());

export function renderMarkdown(text) {
  const frag = document.createDocumentFragment();
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blank = (l) => /^\s*$/.test(l);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }

    // blocco di codice
    const fence = /^\s*(`{3,}|~{3,})\s*([^`]*)$/.exec(line);
    if (fence !== null) {
      const marker = fence[1];
      const lang = fence[2].trim();
      const body = [];
      i++;
      while (i < lines.length) {
        const close = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[i]);
        if (close !== null && close[1][0] === marker[0] && close[1].length >= marker.length) { i++; break; }
        body.push(lines[i]);
        i++;
      }
      const pre = document.createElement("pre");
      pre.className = "os-code";
      const code = document.createElement("code");
      if (lang !== "") code.setAttribute("data-lang", lang);
      code.textContent = body.join("\n");
      pre.append(code);
      frag.append(pre);
      continue;
    }

    // intestazione
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = Math.min(6, heading[1].length + 2); // # -> h3: resta sotto il titolo del pannello
      const h = document.createElement(`h${level}`);
      h.append(mdInline(heading[2].trim()));
      frag.append(h);
      i++;
      continue;
    }

    // riga orizzontale
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      frag.append(document.createElement("hr"));
      i++;
      continue;
    }

    // tabella GFM
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const header = mdCells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && !blank(lines[i])) {
        rows.push(mdCells(lines[i]));
        i++;
      }
      frag.append(mdTable(header, rows));
      continue;
    }

    // citazione
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const blockquote = document.createElement("blockquote");
      blockquote.append(renderMarkdown(quote.join("\n")));
      frag.append(blockquote);
      continue;
    }

    // liste
    if (MD_ITEM.test(line)) {
      const items = [];
      while (i < lines.length && MD_ITEM.test(lines[i])) {
        const m = MD_ITEM.exec(lines[i]);
        items.push({ indent: m[1].replace(/\t/g, "  ").length, ordered: /\d/.test(m[2]), text: m[3] });
        i++;
      }
      frag.append(mdList(items));
      continue;
    }

    // paragrafo
    const para = [];
    while (i < lines.length && !blank(lines[i]) && !MD_ITEM.test(lines[i])
      && !/^(#{1,6})\s/.test(lines[i]) && !/^\s*>\s?/.test(lines[i])
      && !/^\s*(`{3,}|~{3,})/.test(lines[i]) && !/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    const p = document.createElement("p");
    p.append(mdInline(para.join("\n")));
    frag.append(p);
  }
  return frag;
}

// ───────────────────────────────────────────────────────────────────────────
// Dettaglio di una change: elenco artefatti + file delle specs.
// Il contenuto dei documenti si legge a parte (loadDoc), solo quando serve.
// ───────────────────────────────────────────────────────────────────────────
const DETAIL_TTL_MS = 60_000;
const MAX_SPEC_FILES = 12;

const detailCache = new Map(); // `${workspaceKey}|${change}` -> { detail, loadedAt, inFlight }
const docCache = new Map();    // `${workspaceKey}|${path}`    -> { doc, loadedAt, inFlight }

function clearWorkspaceCaches(workspaceKey) {
  const prefix = `${workspaceKey}|`;
  for (const key of [...validationCache.keys()]) if (key.startsWith(prefix)) validationCache.delete(key);
  for (const key of [...detailCache.keys()]) if (key.startsWith(prefix)) detailCache.delete(key);
  for (const key of [...docCache.keys()]) if (key.startsWith(prefix)) docCache.delete(key);
  const listEntry = cache.get(workspaceKey);
  if (listEntry !== undefined) listEntry.loadedAt = 0;
}

async function readSpecList(files, base, detail) {
  const out = { state: "absent", files: [], truncated: false, error: null };
  const root = await safeList(files, `${base}/specs/`);
  if (root.error) {
    out.state = "error";
    out.error = errMessage(root.error);
    return out;
  }
  const caps = (root.entries || []).filter(e => e.type === "directory" || e.type === "symlink");
  const found = [];
  for (const cap of caps) {
    if (found.length >= MAX_SPEC_FILES) { out.truncated = true; break; }
    const inner = await safeList(files, `${base}/specs/${cap.name}/`);
    if (inner.error) {
      detail.errors.push(`${cap.name}: ${errMessage(inner.error)}`);
      continue;
    }
    for (const entry of inner.entries || []) {
      if (entry.type !== "file" || !entry.name.toLowerCase().endsWith(".md")) continue;
      if (found.length >= MAX_SPEC_FILES) { out.truncated = true; break; }
      found.push({ capability: cap.name, name: entry.name, path: `${base}/specs/${cap.name}/${entry.name}` });
    }
  }
  found.sort((a, b) => a.capability.localeCompare(b.capability) || a.name.localeCompare(b.name));
  out.files = found;
  out.state = found.length > 0 ? "present" : "absent";
  return out;
}

// Validita' della change: task e validita' sono due cose diverse, quindi lo
// stato qui non guarda l'avanzamento ma la struttura (proposal, deltas,
// requisiti e scenari). Restituisce "unverified" quando non ha potuto leggere
// cio' che serve: meglio nessun giudizio che un giudizio inventato.
export function inspectChangeValidity({ proposalText, hasProposal, specFiles, hasSpecs, skipSpecs }) {
  // Due secchi separati: "incomplete" = artefatto non ancora creato,
  // "invalid" = artefatto presente ma non conforme alle regole del CLI.
  const incomplete = [];
  const invalid = [];
  const warnings = [];
  if (skipSpecs === true) {
    return { state: "valid", reasons: ["skip_specs: true in .openspec.yaml"], checked: true };
  }
  if (hasProposal !== true && typeof proposalText !== "string") {
    incomplete.push("proposal.md missing");
  } else if (typeof proposalText !== "string") {
    return { state: "unverified", reasons: ["proposal.md not readable"], checked: false };
  } else {
    const section = (heading) => {
      const found = new RegExp(`^##\\s+${heading}\\s*$`, "im").exec(proposalText);
      if (found === null) return null;
      return proposalText.slice(found.index + found[0].length).split(/^##\s+/m)[0].trim();
    };
    const why = section("Why");
    if (why === null || why.length < MIN_WHY_LENGTH) {
      invalid.push(`Why section missing or shorter than ${MIN_WHY_LENGTH} characters`);
    }
    const what = section("What Changes");
    if (what === null || what.length === 0) invalid.push("What Changes section missing or empty");
  }

  if (hasSpecs !== true || specFiles.length === 0) {
    incomplete.push("no deltas: at least one specs/<capability>/spec.md is required (OpenSpec: \"Change must have at least one delta\")");
    return {
      state: invalid.length > 0 ? "invalid" : "incomplete",
      reasons: [...invalid, ...incomplete],
      warnings,
      checked: true,
    };
  }
  for (const file of specFiles) {
    if (typeof file.content !== "string") {
      return { state: "unverified", reasons: [`${file.path} not readable`], checked: false };
    }
    const lines = file.content.replace(/\r\n/g, "\n").split("\n");
    let deltas = 0;
    let requirement = null;
    let scenarios = 0;
    const closeRequirement = () => {
      if (requirement === null) return;
      if (!/\b(SHALL|MUST)\b/.test(requirement.text)) {
        invalid.push(`${file.path}: requirement "${requirement.title}" has no SHALL/MUST`);
      }
      if (requirement.scenarios === 0) {
        invalid.push(`${file.path}: requirement "${requirement.title}" has no "#### Scenario:"`);
      }
      // Come il CLI: testo molto lungo e' un avviso, non un errore.
      if (requirement.text.trim().length > MAX_REQUIREMENT_TEXT) {
        warnings.push(`${file.path}: requirement "${requirement.title}" is longer than ${MAX_REQUIREMENT_TEXT} characters`);
      }
    };
    for (const line of lines) {
      if (DELTA_HEADER.test(line)) { deltas++; continue; }
      const req = REQUIREMENT_HEADER.exec(line);
      if (req !== null) {
        closeRequirement();
        requirement = { title: req[1].trim() || "(untitled)", text: "", scenarios: 0 };
        continue;
      }
      if (SCENARIO_HEADER.test(line)) {
        if (requirement !== null) requirement.scenarios++;
        scenarios++;
        continue;
      }
      // Solo la prosa del requisito: gli scenari non concorrono al limite.
      if (requirement !== null && requirement.scenarios === 0) requirement.text += line + "\n";
    }
    closeRequirement();
    if (deltas === 0) {
      invalid.push(`${file.path}: no delta header (## ADDED/MODIFIED/REMOVED/RENAMED Requirements)`);
    }
    if (scenarios === 0) {
      invalid.push(`${file.path}: no "#### Scenario:" block`);
    }
  }
  const reasons = [...invalid, ...incomplete];
  if (invalid.length > 0) return { state: "invalid", reasons, warnings, checked: true };
  if (incomplete.length > 0) return { state: "incomplete", reasons, warnings, checked: true };
  return { state: "valid", reasons: [], warnings, checked: true };
}

const validationCache = new Map(); // `${workspaceKey}|${change}` -> { result, loadedAt }

async function loadValidation(context, name, detail) {
  const wsKey = openSpecKey(context);
  const key = `${wsKey}|${name}`;
  const hit = validationCache.get(key);
  if (hit !== undefined && Date.now() - hit.loadedAt < DETAIL_TTL_MS) return hit.result;
  let result;
  try {
    const proposal = await loadDoc(context, `${CHANGES_DIR}/${name}/proposal.md`);
    const specFiles = [];
    for (const file of detail.specs.files) {
      const doc = await loadDoc(context, file.path);
      specFiles.push({ path: file.path, content: doc.state === "ok" || doc.state === "truncated" ? doc.content : null });
    }
    let skipSpecs = false;
    try {
      const meta = await context.files.readFile(`${CHANGES_DIR}/${name}/.openspec.yaml`);
      skipSpecs = /^\s*skip_specs\s*:\s*true\s*$/im.test(meta.content);
    } catch { /* nessun metadata: nessuno skip */ }
    result = inspectChangeValidity({
      proposalText: proposal.state === "ok" || proposal.state === "truncated" ? proposal.content : null,
      hasProposal: detail.artifacts.proposal === "present",
      specFiles,
      hasSpecs: detail.specs.state === "present",
      skipSpecs,
    });
  } catch {
    result = { state: "unverified", reasons: ["validation could not run"], checked: false };
  }
  validationCache.set(key, { result, loadedAt: Date.now() });
  return result;
}

async function readChangeDetail(context, name) {
  const files = context.files;
  const base = `${CHANGES_DIR}/${name}`;
  const detail = {
    state: "ready", name, artifacts: allUnknown(),
    specs: { state: "absent", files: [], truncated: false, error: null },
    errors: [], error: null,
  };
  const listing = await safeList(files, `${base}/`);
  if (listing.error) {
    detail.state = "error";
    detail.error = `Cannot read ${base}/: ${errMessage(listing.error)}`;
    return detail;
  }
  detail.artifacts = classifyArtifacts(listing.entries);
  if (detail.artifacts.specs !== "absent") {
    detail.specs = await readSpecList(files, base, detail);
    detail.artifacts.specs = detail.specs.state === "error" ? "unknown"
      : detail.specs.state === "present" ? "present" : "absent";
  }
  return detail;
}

export function loadChangeDetail(context, name) {
  const wsKey = openSpecKey(context);
  const key = `${wsKey}|${name}`;
  let entry = detailCache.get(key);
  if (entry === undefined) {
    entry = { detail: null, loadedAt: 0, inFlight: null };
    detailCache.set(key, entry);
  }
  if (entry.detail !== null && Date.now() - entry.loadedAt < DETAIL_TTL_MS) return Promise.resolve(entry.detail);
  if (entry.inFlight !== null) return entry.inFlight;
  entry.inFlight = readChangeDetail(context, name)
    .then(detail => {
      entry.detail = detail;
      entry.loadedAt = Date.now();
      return detail;
    })
    .finally(() => { entry.inFlight = null; });
  return entry.inFlight;
}

// Contenuto di un documento: ok / error / binary / truncated, letto una volta per TTL.
export function loadDoc(context, path) {
  const wsKey = openSpecKey(context);
  const key = `${wsKey}|${path}`;
  let entry = docCache.get(key);
  if (entry === undefined) {
    entry = { doc: null, loadedAt: 0, inFlight: null };
    docCache.set(key, entry);
  }
  if (entry.doc !== null && Date.now() - entry.loadedAt < DETAIL_TTL_MS) return Promise.resolve(entry.doc);
  if (entry.inFlight !== null) return entry.inFlight;
  entry.inFlight = context.files.readFile(path)
    .then(res => {
      if (res.binary) return { state: "binary", path, error: "binary file" };
      return {
        state: res.truncated ? "truncated" : "ok",
        path,
        content: typeof res.content === "string" ? res.content : "",
        error: res.truncated ? "file is truncated" : null,
      };
    })
    // "assente" lo decide l'elenco degli artefatti (il host rifiuta allo stesso
    // modo un file mancante e uno illeggibile): qui un errore e' un errore.
    .catch(err => ({ state: "error", path, error: errMessage(err) }))
    .then(doc => {
      entry.doc = doc;
      entry.loadedAt = Date.now();
      return doc;
    })
    .finally(() => { entry.inFlight = null; });
  return entry.inFlight;
}

const ARTIFACT_ORDER = ["proposal", "design", "specs", "tasks"];
const ARTIFACT_LABEL = { proposal: "Proposal", design: "Design", specs: "Specs", tasks: "Tasks" };

// ───────────────────────────────────────────────────────────────────────────
// Task parser
// Portato da pi-openspec-status 0.8.1 (extension/tasks-parser.ts) con un
// hardening documentato: i contenuti dei block di codice (``` / ~~~) non sono
// conteggiati, così un esempio con caselle nel file non distortinga il
// contatore. Semantica altrimenti identica:
//   - gruppi delimitati da heading "## "
//   - conteggio righe "- [x]" (done) e "- [ ]" (pending)
//   - contenuto prima del primo "##" e righe non-checkbox ignorati
// ───────────────────────────────────────────────────────────────────────────
export function parseTaskGroups(content) {
  try {
    if (typeof content !== "string") return [];
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const n = lines.length;
    // Segna per riga se è una heading "## ", e se è all'interno (o è una
    // riga-fence) di un blocco di codice. Le righe-fence vanno saltate anche
    // quando si contano le task, non solo quando si cercano le heading.
    const isHeading = new Array(n).fill(false);
    const isFenceLine = new Array(n).fill(false);
    let inFence = false;
    let fenceChar = "";
    for (let i = 0; i < n; i++) {
      const line = lines[i];
      const fence = line.match(/^(`{3,}|~{3,})/);
      if (inFence) {
        isFenceLine[i] = true;
        // Chiusura CommonMark: stesso carattere, lunghezza >= apertura.
        if (fence !== null && fence[1][0] === fenceChar[0] && fence[1].length >= fenceChar.length) inFence = false;
      } else if (fence !== null) {
        isFenceLine[i] = true;
        inFence = true;
        fenceChar = fence[1];
      } else {
        if (/^##\s/.test(line)) isHeading[i] = true;
      }
    }
    const headingIndices = [];
    for (let i = 0; i < n; i++) if (isHeading[i]) headingIndices.push(i);
    if (headingIndices.length === 0) return [];
    const groups = [];
    for (let g = 0; g < headingIndices.length; g++) {
      const startLine = headingIndices[g];
      const endLine = g + 1 < headingIndices.length ? headingIndices[g + 1] : n;
      const groupName = lines[startLine].replace(/^##\s+/, "").trim();
      let completed = 0;
      let total = 0;
      for (let i = startLine + 1; i < endLine; i++) {
        if (isFenceLine[i]) continue;
        const cl = lines[i];
        if (/^- \[x\]/i.test(cl)) { completed++; total++; }
        else if (/^- \[ \]/.test(cl)) { total++; }
      }
      groups.push({ name: groupName, completed, total, status: taskGroupStatus(completed, total) });
    }
    return groups;
  } catch {
    return [];
  }
}

function taskGroupStatus(completed, total) {
  if (total === 0) return "empty";
  if (completed === total) return "complete";
  if (completed === 0) return "none";
  return "partial";
}

// ───────────────────────────────────────────────────────────────────────────
// Classificazione artefatti e stati
// Stato per artefatto:
//   "present" -> file presente / specs/ non vuoto
//   "absent"  -> assente (o specs/ assente o vuoto)
//   "unknown" -> stato non determinabile (errore di lettura)
// ───────────────────────────────────────────────────────────────────────────
function entryOf(entries, name, type) {
  for (const e of entries) {
    if (e.type === type && e.name === name) return e;
  }
  return null;
}

export function classifyArtifacts(entries) {
  const list = Array.isArray(entries) ? entries : [];
  // Un symlink puo' puntare a un file o a una directory: vale come entrambi,
  // cosi' un artefatto linkato non risulta assente.
  const entry = (name, type) => entryOf(list, name, type) || entryOf(list, name, "symlink");
  return {
    proposal: entry("proposal.md", "file") ? "present" : "absent",
    design: entry("design.md", "file") ? "present" : "absent",
    specs: entry("specs", "directory") ? null : "absent", // null = directory presente, da sondare
    tasks: entry("tasks.md", "file") ? "present" : "absent",
  };
}

function allUnknown() {
  return { proposal: "unknown", design: "unknown", specs: "unknown", tasks: "unknown" };
}

// ───────────────────────────────────────────────────────────────────────────
// Cache per workspace + coalescing dei fetch in flight
// ───────────────────────────────────────────────────────────────────────────
const cache = new Map();

// Contesto senza machine/workspace (capita durante l'hydration del host): una
// chiave unica per oggetto evita di condividere la cache fra contesti diversi.
const anonymousKeys = new WeakMap();
let anonymousKeySeq = 0;
function openSpecKey(context) {
  const machine = context?.machine?.id;
  const workspace = context?.workspace?.id;
  if (machine !== undefined && workspace !== undefined) return `${machine}:${workspace}`;
  if (context === null || typeof context !== "object") return "anonymous:0";
  let key = anonymousKeys.get(context);
  if (key === undefined) {
    key = `anonymous:${++anonymousKeySeq}`;
    anonymousKeys.set(context, key);
  }
  return key;
}

function pruneCache() {
  const now = Date.now();
  // Prima della prima lettura entry.loadedAt === 0: `now - 0` sarebbe un
  // numero enorme e priverebbe l'entry appena creata (in flight) prima che
  // doLoad torni. Pruna solo le entry già caricate (loadedAt > 0).
  for (const [key, entry] of cache) {
    if (entry.loadedAt > 0 && now - entry.loadedAt > CACHE_MAX_AGE_MS) cache.delete(key);
  }
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = [...cache.entries()]
      .filter(([, e]) => e.loadedAt > 0)
      .sort((a, b) => a[1].loadedAt - b[1].loadedAt)
      .slice(0, cache.size - CACHE_MAX_ENTRIES)
      .map(([k]) => k);
    for (const key of oldest) cache.delete(key);
  }
}

function errMessage(err) {
  return (err && typeof err.message === "string" && err.message) || String(err);
}

async function loadState(context) {
  const files = context.files;
  const state = {
    kind: "ready",
    changes: [],
    errors: [],
    truncated: false,
    error: null,
    archiveCount: null,
    scannedAt: null,
  };
  try {
    // Sonda "openspec/" per distinguere "nessun progetto OpenSpec" da un
    // errore di lettura di openspec/changes: l'host rifiuta entrambi i casi
    // con lo stesso reject, quindi usiamo due sondi invece di analizzare
    // messaggi d'errore.
    const openspec = await safeList(files, "openspec");
    if (openspec.error) {
      state.kind = "not-found";
      state.error = "No OpenSpec project in this workspace.";
      return state;
    }
    if (openspec.truncated) state.truncated = true;

    const changesDir = await safeList(files, CHANGES_DIR);
    if (changesDir.error) {
      state.kind = "error";
      state.error = `OpenSpec read error: ${errMessage(changesDir.error)}.`;
      return state;
    }
    if (changesDir.truncated) state.truncated = true;

    // "symlink" incluso: una change linkata e' una change (l'elenco successivo
    // dira' se il bersaglio e' leggibile).
    const dirish = e => e.type === "directory" || e.type === "symlink";
    const allActive = changesDir.entries
      .filter(e => dirish(e) && e.name !== ARCHIVE_DIR);
    // Stesso tetto dell'indice: ogni change costa fino a 3 letture (elenco,
    // specs/, tasks.md). Senza tetto un workspace con centinaia di change
    // genererebbe centinaia di richieste al primo render del pannello.
    const active = allActive.slice(0, INDEX_MAX_CHANGES);
    if (allActive.length > active.length) state.truncated = true;

    if (active.length === 0) {
      state.kind = "no-active";
      state.archiveCount = await countArchived(files);
      return state;
    }

    const changes = [];
    for (const ch of active) {
      const base = `${CHANGES_DIR}/${ch.name}/`;
      const listing = await safeList(files, base);
      if (listing.error) {
        state.errors.push(`${ch.name}: ${errMessage(listing.error)}`);
        changes.push({ name: ch.name, artifacts: allUnknown(), tasks: unknownTasks(), error: "Cannot read change directory" });
        continue;
      }
      if (listing.truncated) state.truncated = true;
      const artifacts = classifyArtifacts(listing.entries);
      // specs/ presente: deve essere non vuoto per essere "present"
      if (artifacts.specs === null) {
        const specs = await safeList(files, `${base}specs/`);
        if (specs.error) {
          artifacts.specs = "unknown";
          state.errors.push(`${ch.name}: ${errMessage(specs.error)}`);
        } else {
          if (specs.truncated) state.truncated = true;
          artifacts.specs = specs.entries.length > 0 ? "present" : "absent";
        }
      }
      // tasks.md assente e' uno stato normale ("–" nel pannello), non un
      // errore di lettura: si legge (e si segnala) solo se l'elenco lo dà
      // presente.
      let tasks;
      if (artifacts.tasks === "present") {
        tasks = await countTasks(files, ch.name);
        if (tasks.error) state.errors.push(`${ch.name}: ${tasks.error}`);
      } else {
        tasks = unknownTasks();
      }
      // shape costante: error sempre presente (null in caso di successo).
      changes.push({ name: ch.name, artifacts, tasks, error: null });
    }
    state.changes = changes;
    return state;
  } catch (err) {
    state.kind = "error";
    state.error = `OpenSpec read error: ${errMessage(err)}.`;
    return state;
  }
}

// L'orario si marca a lettura finita: con molte richieste in serie quello di
// inizio sarebbe gia' vecchio quando il pannello lo mostra.
async function doLoad(context) {
  const state = await loadState(context);
  state.scannedAt = new Date().toISOString();
  return state;
}

async function safeList(files, path) {
  try {
    const res = await files.listFiles(path);
    if (res === null || typeof res !== "object") return { entries: [], truncated: false };
    return { ...res, entries: Array.isArray(res.entries) ? res.entries : [] };
  } catch (err) {
    return { error: err };
  }
}

async function countArchived(files) {
  try {
    const res = await safeList(files, `${CHANGES_DIR}/${ARCHIVE_DIR}`);
    if (res.error || res.truncated) return null;
    return res.entries.filter(e => e.type === "directory" || e.type === "symlink").length;
  } catch {
    return null;
  }
}

async function countTasks(files, changeName) {
  try {
    const res = await files.readFile(`${CHANGES_DIR}/${changeName}/tasks.md`);
    if (res.truncated) {
      return { completed: 0, total: 0, known: false, error: "tasks.md file is truncated; count unavailable" };
    }
    if (res.binary) {
      return { completed: 0, total: 0, known: false, error: "tasks.md is binary; count unavailable" };
    }
    if (typeof res.content !== "string") {
      return { completed: 0, total: 0, known: false, error: "tasks.md content is not text" };
    }
    const groups = parseTaskGroups(res.content);
    const completed = groups.reduce((n, g) => n + g.completed, 0);
    const total = groups.reduce((n, g) => n + g.total, 0);
    return { completed, total, known: true };
  } catch {
    return { completed: 0, total: 0, known: false, error: "cannot read tasks.md" };
  }
}

function unknownTasks() {
  return { completed: 0, total: 0, known: false, error: null };
}

// ───────────────────────────────────────────────────────────────────────────
// Cache pubblica + coalescing
// ───────────────────────────────────────────────────────────────────────────
function makeCacheEntry() {
  return { state: null, loadedAt: 0, inFlight: null };
}

// Ritorna una Promise di { state, cacheHit }: cacheHit=true se la cache era
// valida entro il TTL (e force=false); cacheHit=false per un fetch nuovo o
// coalesced su un fetch in flight.
export function loadOpenSpecState(context, options = {}) {
  const { force = false } = options || {};
  const key = openSpecKey(context);
  let entry = cache.get(key);
  if (entry === undefined) {
    entry = makeCacheEntry();
    cache.set(key, entry);
    pruneCache();
  }
  // Cache hit: stato già risolto.
  if (entry.state !== null && !force && entry.loadedAt > 0 && Date.now() - entry.loadedAt < ACTIVE_TTL_MS) {
    return Promise.resolve({ state: entry.state, cacheHit: true });
  }
  // Coalescing: se c'è un fetch in flight, riutilizziamo lo stesso Promise.
  // entry.inFlight risolve a { state, fresh } (stato già risolto). A resolve
  // (o reject) lo metti a null: un fetch terminato non va più coalesced e
  // un nuovo richiamo (anche force) riparte un fetch fresco.
  if (entry.inFlight !== null) return entry.inFlight;
  entry.inFlight = doLoad(context)
    .then(state => {
      entry.state = state;
      entry.loadedAt = Date.now();
      return { state, cacheHit: false };
    })
    .finally(() => {
      entry.inFlight = null;
    });
  return entry.inFlight;
}

// ───────────────────────────────────────────────────────────────────────────
// Elemento DOM del pannello (plain DOM, nessun Lit a runtime)
// Il binding .context è fatto dal template del host (Lit setValue imposta la
// proprietà element.context); qui lo gestiamo con un accessor.
// ───────────────────────────────────────────────────────────────────────────
// Set (non WeakSet): il ciclo di vita è gestito da connected/disconnectedCallback,
// e WeakSet non è iterabile in Node (ambiente di test). delete() su disconnect
// evita il leak; un elemento rimosso dal DOM riceve disconnectedCallback.
const mountedElements = new Set();

const DOC_TABS = [
  { key: "proposal", label: "Proposal", file: "proposal.md" },
  { key: "design", label: "Design", file: "design.md" },
  { key: "specs", label: "Specs", file: null },
  { key: "tasks", label: "Tasks", file: "tasks.md" },
];

class OpenspecPanelElement extends HTMLElement {
  #context = null;
  #generation = 0;
  #state = null;
  #shadow = null;
  #nodes = null;
  #lastForce = 0;

  // Dettaglio della change selezionata e tab aperto.
  #selected = null;
  #detail = null;
  #detailStatus = "idle"; // idle | loading | ready | error
  #tab = "proposal";
  #specIndex = 0;
  #doc = null;            // { status, path, content, error }
  #docSeq = 0;
  #detailSeq = 0;         // ordine dei load di dettaglio (una risposta vecchia non vince)
  #pending = false;       // un refresh manuale e' in corso
  #timer = null;          // controllo periodico delle modifiche esterne
  #fingerprint = null;    // impronta degli elenchi all'ultima lettura buona
  #validity = null;       // { state, reasons } della change selezionata
  #probing = false;       // una sonda e' in corso (niente richieste concorrenti)
  #restored = false;      // il ripristino da navigation e' gia' stato tentato

  get context() {
    return this.#context;
  }

  set context(value) {
    const prev = this.#context;
    const sameWorkspace = prev !== null && prev !== undefined
      && prev.machine?.id === value?.machine?.id
      && prev.workspace?.id === value?.workspace?.id;
    this.#context = value;
    // Un altro workspace (anche con una change omonima) non eredita selezione,
    // dettaglio o documento: si riparte dall'elenco.
    if (!sameWorkspace) this._resetSelection();
    this._refresh();
  }

  _resetSelection() {
    this.#detailSeq++;   // invalida i load di dettaglio in corso
    this.#docSeq++;      // e quelli dei documenti
    this.#selected = null;
    this.#detail = null;
    this.#detailStatus = "idle";
    this.#doc = null;
    this.#tab = "proposal";
    this.#specIndex = 0;
    this.#restored = false;
    this.#validity = null;
    this.#fingerprint = null;
  }

  // Stato renderizzato (null prima del primo render). Esposto per test/host.
  get state() {
    return this.#state;
  }

  _shadow() {
    if (this.#shadow === null) this.#shadow = ensureShadow(this, PANEL_CSS, "panel");
    return this.#shadow;
  }

  connectedCallback() {
    this._buildSkeleton();
    mountedElements.add(this);
    this._refresh();
    this._startTimer();
  }

  disconnectedCallback() {
    this.#generation++;
    this.#detailSeq++;
    this.#docSeq++;
    this._stopTimer();
    mountedElements.delete(this);
  }

  // ── controllo periodico delle modifiche esterne ──────────────────────────
  _startTimer() {
    if (this.#timer !== null) return;
    if (typeof setInterval !== "function") return;
    this.#timer = setInterval(() => { void this._checkExternalChanges(); }, EXTERNAL_CHECK_MS);
    // In Node (test) un timer attivo terrebbe vivo il processo: non deve.
    if (typeof this.#timer?.unref === "function") this.#timer.unref();
  }

  // Seam di test: dice se il controllo periodico e' attivo.
  get hasTimer() {
    return this.#timer !== null;
  }

  _stopTimer() {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
    this.#probing = false;
  }

  // Confronta l'impronta degli elenchi con quella dell'ultima lettura buona:
  // se non e' cambiata non succede nulla (nessun render, nessuna richiesta di
  // contenuto). Le modifiche esterne cambiano almeno una dimensione o un mtime.
  async _checkExternalChanges() {
    if (!this.isConnected || this.#probing || this.#pending) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const ctx = this.#context;
    if (ctx === null || ctx.files === undefined) return;
    this.#probing = true;
    try {
      const fingerprint = await this._probe(ctx);
      if (fingerprint === null) return;
      if (ctx !== this.#context) return;
      if (this.#fingerprint === null) { this.#fingerprint = fingerprint; return; }
      if (fingerprint === this.#fingerprint) return;
      this.#fingerprint = fingerprint;
      this._reload(ctx, { silent: true }); // conserva selezione, scheda e documento
    } finally {
      this.#probing = false;
    }
  }

  async _probe(ctx) {
    try {
      const top = await ctx.files.listFiles(CHANGES_DIR);
      const names = (top.entries || [])
        .filter(e => (e.type === "directory" || e.type === "symlink") && e.name !== ARCHIVE_DIR)
        .map(e => e.name)
        .sort()
        .slice(0, INDEX_MAX_CHANGES);
      const parts = [];
      for (const name of names) {
        const base = `${CHANGES_DIR}/${name}`;
        const listing = await ctx.files.listFiles(`${base}/`);
        const sig = (listing.entries || [])
          .map(e => `${e.name}:${e.type}:${e.size ?? ""}:${e.modifiedAt ?? ""}`)
          .sort()
          .join(",");
        parts.push(`${name}|${sig}`);
        const hasSpecs = (listing.entries || []).some(e => e.name === "specs");
        if (!hasSpecs) continue;
        const caps = await ctx.files.listFiles(`${base}/specs/`);
        for (const cap of (caps.entries || []).filter(e => e.type === "directory" || e.type === "symlink")) {
          const inner = await ctx.files.listFiles(`${base}/specs/${cap.name}/`);
          const specSig = (inner.entries || [])
            .map(e => `${e.name}:${e.size ?? ""}:${e.modifiedAt ?? ""}`)
            .sort()
            .join(",");
          parts.push(`  ${cap.name}|${specSig}`);
        }
      }
      return parts.join(";");
    } catch {
      return null;
    }
  }

  _refreshFingerprint(ctx) {
    this._probe(ctx)
      .then(fp => { if (fp !== null && ctx === this.#context) this.#fingerprint = fp; })
      .catch(() => {});
  }

  _buildSkeleton() {
    const root = this._shadow();
    if (this.#nodes !== null) return;
    clearShadow(root);

    const head = this._el("header", "os-header");
    const icon = this._el("span", "os-header-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.append(buildIcon(PANEL_ICON, "currentColor"));
    const title = this._el("span", "os-title");
    title.textContent = "OpenSpec";
    const badge = this._el("span", "os-badge");
    badge.id = "openspec-badge";
    badge.hidden = true;
    const stamp = this._el("span", "stamp os-stamp");
    stamp.id = "openspec-stamp";
    const refresh = this._el("button", "os-refresh");
    refresh.type = "button";
    refresh.id = "openspec-refresh";
    refresh.title = "Reload OpenSpec data";
    refresh.setAttribute("aria-label", "Reload OpenSpec data");
    refresh.textContent = "\u21bb";
    refresh.addEventListener("click", () => this._manualRefresh());
    head.append(icon, title, badge, this._el("span", "os-spacer"), stamp, refresh);

    const body = this._el("main", "body");
    body.id = "openspec-body";

    const errorBox = this._el("p", "error");
    errorBox.id = "openspec-error";
    errorBox.hidden = true;

    root.append(head, body, errorBox);
    this.#nodes = { body, errorBox, badge, stamp, refresh };
  }

  _el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  _refresh() {
    const ctx = this.#context;
    if (ctx === null || ctx.files === undefined) return;
    this._buildSkeleton();
    const generation = this.#generation;
    loadOpenSpecState(ctx)
      .then(res => {
        if (!this.isConnected || this.#generation !== generation) return;
        if (ctx !== this.#context) return; // cambio workspace durante il load
        // L'host reimposta .context a ogni suo render: se lo stato e' lo stesso
        // oggetto (cache hit) non si ricostruisce il DOM.
        if (res.state !== this.#state) {
          this._renderState(res.state);
          this._refreshFingerprint(ctx);
        }
      })
      .catch(err => {
        if (!this.isConnected || this.#generation !== generation) return;
        this._renderState({
          kind: "error", changes: [], errors: [], error: `Render error: ${errMessage(err)}`,
          truncated: false, archiveCount: null, scannedAt: new Date().toISOString()
        });
      });
  }

  // Confronto machine+workspace per l'invalidation: la cache e gli elementi
  // sono keyed su entrambi, un workspace.id identico su un'altra macchina
  // non deve attivare il refresh.
  matchesContext(context) {
    try {
      return this.#context !== null
        && this.#context.machine?.id === context?.machine?.id
        && this.#context.workspace?.id === context?.workspace?.id;
    } catch {
      return false;
    }
  }

  // Invocato dal force refresh su invalidation (host onInvalidate).
  _forceRefresh() {
    const ctx = this.#context;
    if (ctx === null || ctx.files === undefined) return;
    // Il host emette workspace.files anche per l'attivita' dell'agente: senza
    // un minimo intervallo ogni evento rilancerebbe l'intera lettura.
    const now = Date.now();
    if (now - this.#lastForce < FORCE_MIN_INTERVAL_MS) return;
    this.#lastForce = now;
    this._reload(ctx, { silent: true });
  }

  // Refresh manuale dal pulsante: scarta le cache del workspace (elenco,
  // dettaglio, documenti) e rilegge. Nel frattempo la UI mostra il caricamento,
  // non i dati vecchi.
  _manualRefresh() {
    const ctx = this.#context;
    if (ctx === null || ctx.files === undefined || this.#pending) return;
    this._lastForce = Date.now();
    this._reload(ctx, { silent: false });
  }

  _reload(ctx, { silent }) {
    clearWorkspaceCaches(openSpecKey(ctx));
    this.#pending = true;
    if (!silent) this._setBusy(true);
    const generation = this.#generation;
    loadOpenSpecState(ctx, { force: true })
      .then(res => {
        if (!this.isConnected || this.#generation !== generation || ctx !== this.#context) return;
        this.#pending = false;
        this._setBusy(false);
        this._refreshFingerprint(ctx);
        // Le cache del workspace sono state svuotate: il dettaglio aperto va
        // riletto, altrimenti resterebbe a schermo il contenuto precedente.
        this.#detail = null;
        this.#detailStatus = this.#selected === null ? "idle" : "loading";
        this.#doc = null;
        this._renderState(res.state);
        if (this.#selected !== null) this._openChange(this.#selected, { keepTab: true });
      })
      .catch(err => {
        if (!this.isConnected || this.#generation !== generation || ctx !== this.#context) return;
        this.#pending = false;
        this._setBusy(false);
        this._renderState({
          kind: "error", changes: [], errors: [], error: `Refresh failed: ${errMessage(err)}`,
          truncated: false, archiveCount: null, scannedAt: null,
        });
      });
  }

  _setBusy(busy) {
    const { refresh } = this.#nodes;
    refresh.setAttribute("aria-busy", busy ? "true" : "false");
    refresh.classList.toggle("os-refresh--busy", busy);
    refresh.disabled = busy;
  }

  _renderState(state) {
    this.#state = state;
    if (this.#nodes === null) this._buildSkeleton();
    const { body, errorBox, badge, stamp } = this.#nodes;

    const changes = state.kind === "ready" && Array.isArray(state.changes) ? state.changes : [];
    const n = changes.length;

    if (n > 0) {
      badge.textContent = String(n);
      badge.title = n === 1 ? "1 active change" : `${n} active changes`;
      badge.hidden = false;
    } else {
      badge.textContent = "";
      badge.title = "";
      badge.hidden = true;
    }

    // Lo stato "not-found" e "no-active" hanno gia' il loro messaggio nel
    // corpo: ripeterlo qui in rosso raddoppiava la riga. Restano nel box solo
    // gli errori di lettura veri, i primi tre, con il dettaglio nel title.
    const parts = [];
    if (state.kind === "error" && state.error) parts.push(state.error);
    if (Array.isArray(state.errors) && state.errors.length > 0) {
      for (const e of state.errors) parts.push(e);
    }
    const shown = parts.slice(0, 3);
    let msg = shown.join(" | ");
    if (parts.length > shown.length) msg += ` | … and ${parts.length - shown.length} more`;
    errorBox.textContent = msg;
    errorBox.title = parts.join("\n");
    errorBox.hidden = parts.length === 0;

    let stampText = "";
    if (state.scannedAt) {
      try {
        stampText = new Date(state.scannedAt).toLocaleTimeString();
      } catch {
        stampText = state.scannedAt;
      }
    }
    if (state.truncated) stampText = `${stampText} (list truncated)`;
    stamp.textContent = stampText;
    stamp.title = state.scannedAt ? `Data read at ${new Date(state.scannedAt).toLocaleString()}` : "";

    // La selezione sopravvive al refresh solo se la change esiste ancora.
    if (this.#selected !== null && !changes.some(ch => ch.name === this.#selected)) {
      this.#selected = null;
      this.#detail = null;
      this.#detailStatus = "idle";
      this.#doc = null;
    }

    body.textContent = "";
    if (state.kind === "not-found") {
      body.append(this._text("p empty", "No OpenSpec project in this workspace."));
      return;
    }
    if (state.kind === "no-active") {
      let txt = "No active changes.";
      if (state.archiveCount !== null && state.archiveCount !== undefined) txt += ` (${state.archiveCount} archived)`;
      body.append(this._text("p empty", txt));
      return;
    }
    if (state.kind !== "ready") {
      body.append(this._text("p error-state", "OpenSpec read error."));
      return;
    }
    if (changes.length === 0) {
      body.append(this._text("p empty", "No active changes."));
      return;
    }

    body.append(this._changeListNode(changes, n > 1));
    // Al primo render (o dopo un ritorno da un altro tool) l'host puo' aver
    // conservato la selezione nella query del pannello: la si ripristina.
    if (this.#selected === null && this.#restored === false) {
      this.#restored = true;
      if (this._restoreSelection(changes)) {
        body.textContent = "";
        body.append(this._changeListNode(changes, n > 1), this._detailNode());
        this._openChange(this.#selected, { keepTab: true });
        return;
      }
    }
    if (this.#selected !== null) body.append(this._detailNode());
    else body.append(this._text("p os-hint", "Select a change to see its documents."));
  }

  _text(cls, text) {
    const p = this._el("p", cls);
    p.textContent = text;
    return p;
  }

  // ── elenco change (compatto, selezionabile) ──────────────────────────────
  _changeListNode(changes, expanded) {
    const list = this._el("div", "os-list");
    list.id = "openspec-list";
    list.setAttribute("role", "list");
    if (expanded) {
      const section = this._el("h2", "os-section");
      section.textContent = "Active changes";
      list.append(section);
    }
    for (const ch of changes) list.append(this._changeCard(ch, changes.length === 1));
    return list;
  }

  _changeCard(ch, focus) {
    const selected = this.#selected === ch.name;
    const card = this._el("div", `change${selected ? " change--selected" : ""}`);
    card.setAttribute("role", "listitem");

    const toggle = this._el("button", "os-change-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", selected ? "true" : "false");
    toggle.setAttribute("aria-controls", "openspec-detail");
    toggle.title = `Show documents of ${ch.name}`;
    toggle.addEventListener("click", () => this._openChange(ch.name));

    const name = this._el("span", "name");
    name.textContent = ch.name;
    toggle.append(name, this._statusNode(ch));

    const tasks = this._tasksCountNode(ch);
    if (selected && this.#validity !== null) toggle.append(this._validityBadge(this.#validity.state));
    const arts = this._artifactsNode(ch.artifacts);
    if (focus) {
      toggle.append(tasks);
      card.append(toggle);
      card.append(this._progressNode(ch.tasks));
      const metrics = this._el("div", "os-metrics");
      metrics.append(arts);
      card.append(metrics);
    } else {
      toggle.append(tasks);
      card.append(toggle);
      card.append(this._progressNode(ch.tasks), arts);
    }

    if (ch.error) {
      const e = this._el("span", "change-error");
      e.textContent = "  \u26a0 " + ch.error;
      card.append(e);
    }
    return card;
  }

  _statusNode(ch) {
    const st = changeStatus(ch.tasks);
    const pill = this._el("span", st.key === "unknown" ? "os-status" : `os-status os-status--${st.key}`);
    pill.textContent = st.label;
    return pill;
  }

  _artifactsNode(artifacts) {
    const arts = this._el("span", "artifacts");
    for (const key of ARTIFACT_ORDER) {
      const state = artifacts && typeof artifacts[key] === "string" ? artifacts[key] : "unknown";
      const item = this._el("span", `artifact artifact-${key} artifact--${state}`);
      item.textContent = ARTIFACT_LABEL[key];
      item.title = `${ARTIFACT_LABEL[key]}: ${state}`;
      item.setAttribute("data-state", state);
      arts.append(item);
    }
    return arts;
  }

  _tasksCountNode(ch) {
    const tasks = this._el("span", "tasks");
    const text = taskText(ch.tasks);
    if (text !== null) {
      tasks.textContent = text;
      tasks.title = `${ch.tasks.completed} of ${ch.tasks.total} tasks done`;
    } else if (ch.artifacts && ch.artifacts.tasks === "absent") {
      tasks.textContent = "\u2013";
      tasks.title = "No tasks.md";
    } else {
      tasks.textContent = "?";
      tasks.title = (ch.tasks && ch.tasks.error) ? ch.tasks.error : "Task count unknown";
    }
    return tasks;
  }

  _progressNode(tasks) {
    const known = tasks && tasks.known === true && tasks.total > 0;
    const pct = known ? Math.round((100 * tasks.completed) / tasks.total) : null;
    const wrap = this._el("div", known ? "os-progress" : "os-progress os-progress--empty");
    wrap.setAttribute("role", "progressbar");
    wrap.setAttribute("aria-valuemin", "0");
    wrap.setAttribute("aria-valuemax", "100");
    if (known) wrap.setAttribute("aria-valuenow", String(pct));
    const label = known
      ? `Tasks completed: ${tasks.completed} of ${tasks.total} (${pct}%)`
      : (tasks && tasks.known === true ? "No tasks in tasks.md" : "Task progress unavailable");
    wrap.setAttribute("aria-label", label);
    const fill = this._el("div", pct === 100 ? "os-progress-fill os-progress-fill--complete" : "os-progress-fill");
    fill.style.width = `${pct === null ? 0 : pct}%`;
    wrap.append(fill);
    return wrap;
  }

  // ── dettaglio della change selezionata ──────────────────────────────────
  // ── stato di navigazione del pannello (contribution-scoped, per workspace) ──
  _nav() {
    const nav = this.#context?.navigation;
    return nav !== undefined && typeof nav.set === "function" ? nav : null;
  }

  _persistSelection() {
    const nav = this._nav();
    if (nav === null) return;
    try {
      nav.set(NAV_CHANGE, this.#selected, { replace: true });
      nav.set(NAV_TAB, this.#selected === null ? undefined : this.#tab, { replace: true });
      nav.set(NAV_SPEC, this.#selected === null || this.#tab !== "specs" ? undefined : String(this.#specIndex), { replace: true });
    } catch { /* host senza navigazione scrivibile: nessuna persistenza */ }
  }

  // Ripristino al mount (o al ritorno da un altro tool): se la change non
  // esiste piu' si riparte dall'elenco, senza inventare stato.
  _restoreSelection(changes) {
    const nav = this._nav();
    if (nav === null) return false;
    const query = nav.query ?? {};
    const name = typeof query[NAV_CHANGE] === "string" ? query[NAV_CHANGE] : null;
    if (name === null || !changes.some(ch => ch.name === name)) {
      if (name !== null) this._persistSelection(); // nome sparito: ripulisci
      return false;
    }
    const tab = typeof query[NAV_TAB] === "string" ? query[NAV_TAB] : "proposal";
    this.#selected = name;
    this.#tab = DOC_TABS.some(t => t.key === tab) ? tab : "proposal";
    const specIndex = Number.parseInt(typeof query[NAV_SPEC] === "string" ? query[NAV_SPEC] : "0", 10);
    this.#specIndex = Number.isFinite(specIndex) && specIndex >= 0 ? specIndex : 0;
    this.#detail = null;
    this.#detailStatus = "loading";
    this.#doc = null;
    return true;
  }

  _openChange(name, options = {}) {
    const ctx = this.#context;
    if (ctx === null || ctx.files === undefined) return;
    const sameChange = this.#selected === name;
    const keepTab = options.keepTab === true && sameChange;
    this.#selected = name;
    if (!sameChange) {
      // Cambio di change: il dettaglio precedente non deve restare a schermo.
      this.#detail = null;
      this.#detailStatus = "loading";
      this.#doc = null;
    }
    if (!keepTab) {
      this.#tab = "proposal";
      this.#specIndex = 0;
      this.#doc = null;
    }
    this._persistSelection();
    this._renderState(this.#state); // lista + dettaglio (o "Loading change…")
    if (sameChange && this.#detailStatus === "ready" && this.#detail !== null) {
      this._openTab(this.#tab);
      return;
    }
    const generation = this.#generation;
    const seq = ++this.#detailSeq;
    this.#docSeq++; // il documento aperto appartiene alla selezione precedente
    loadChangeDetail(ctx, name)
      .then(detail => {
        if (!this.isConnected || this.#generation !== generation) return;
        if (seq !== this.#detailSeq) return; // superata da una selezione/refresh piu' recente
        if (ctx !== this.#context || this.#selected !== name) return;
        this.#detail = detail;
        this.#detailStatus = detail.state === "error" ? "error" : "ready";
        this.#validity = null;
        this._renderDetailOnly();
        this._openTab(this.#tab);
        this._loadValidity(ctx, name, detail);
      })
      .catch(err => {
        if (!this.isConnected || this.#generation !== generation) return;
        if (seq !== this.#detailSeq) return;
        if (ctx !== this.#context || this.#selected !== name) return;
        this.#detailStatus = "error";
        this.#detail = { state: "error", name, error: errMessage(err), artifacts: allUnknown(), specs: { state: "absent", files: [], truncated: false, error: null }, errors: [] };
        this._renderDetailOnly();
      });
  }

  // Validita' calcolata solo per la change selezionata (un paio di letture,
  // cache per TTL): le altre restano senza giudizio.
  _loadValidity(ctx, name, detail) {
    if (detail.state !== "ready") return;
    loadValidation(ctx, name, detail)
      .then(result => {
        if (!this.isConnected || ctx !== this.#context || this.#selected !== name) return;
        this.#validity = result;
        // Il badge di validita' sta sulla card: si ridisegna la lista, non solo
        // il dettaglio.
        this._renderState(this.#state);
      })
      .catch(() => {});
  }

  // L'etichetta dice cosa e' stato davvero controllato: le regole strutturali
  // di `openspec validate`, non una validazione completa del CLI.
  _validityBadge(state) {
    const pill = this._el("span", `os-validity os-validity--${state}`);
    pill.textContent = state === "valid" ? "structure ok"
      : state === "incomplete" ? "incomplete"
      : state === "invalid" ? "structure!" : "?";
    pill.title = state === "valid" ? "Structural checks pass (not a full openspec validate run)"
      : "Structural checks found problems";
    return pill;
  }

  _renderDetailOnly() {
    const body = this.#nodes.body;
    const current = body.querySelector("#openspec-detail");
    if (current !== null) current.replaceWith(this._detailNode());
  }

  _docPathFor(tabKey) {
    if (this.#detail === null) return null;
    if (tabKey === "specs") {
      const file = this.#detail.specs.files[this.#specIndex];
      return file === undefined ? null : file.path;
    }
    const tab = DOC_TABS.find(t => t.key === tabKey);
    if (tab === undefined || tab.file === null) return null;
    return `${CHANGES_DIR}/${this.#detail.name}/${tab.file}`;
  }

  _detailNode() {
    const wrap = this._el("section", "os-detail");
    wrap.id = "openspec-detail";
    wrap.setAttribute("aria-label", "Change details");
    if (this.#detailStatus === "loading" || this.#detail === null) {
      wrap.setAttribute("aria-busy", "true");
      wrap.append(this._text("p os-muted", "Loading change…"));
      return wrap;
    }
    const detail = this.#detail;
    if (this.#detailStatus === "error") {
      wrap.append(this._text("p error-state", detail.error || "Cannot read this change."));
      return wrap;
    }

    if (detail.errors.length > 0) {
      const err = this._el("p", "error");
      err.textContent = detail.errors.slice(0, 3).join(" | ");
      err.title = detail.errors.join("\n");
      wrap.append(err);
    }

    // Validita': riga discreta, con i motivi consultabili a richiesta.
    if (this.#validity !== null && this.#validity.checked === true && this.#validity.state !== "valid") {
      const box = this._el("div", "os-validity-box");
      box.append(this._validityBadge(this.#validity.state));
      const details = this._el("details", "os-validity-details");
      const summary = this._el("summary");
      summary.textContent = `${this.#validity.reasons.length} reason${this.#validity.reasons.length === 1 ? "" : "s"}`;
      details.append(summary);
      const ul = this._el("ul");
      for (const reason of this.#validity.reasons) {
        const li = this._el("li");
        li.textContent = reason;
        ul.append(li);
      }
      details.append(ul);
      box.append(details);
      box.title = `Structural checks: ${this.#validity.reasons.join(" · ")}`;
      wrap.append(box);
    }

    wrap.append(this._tabsNode(), this._tabPanelNode());
    return wrap;
  }

  _tabsNode() {
    const list = this._el("div", "os-tabs");
    list.setAttribute("role", "tablist");
    list.setAttribute("aria-label", "Change documents");
    for (const tab of DOC_TABS) {
      const selected = this.#tab === tab.key;
      const button = this._el("button", "os-tab");
      button.type = "button";
      button.id = `openspec-tab-${tab.key}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.setAttribute("aria-controls", "openspec-tabpanel");
      button.tabIndex = selected ? 0 : -1;
      button.dataset.tab = tab.key;
      const state = this._tabState(tab.key);
      button.append(this._tabLabelNode(tab, state));
      if (state !== "present") button.classList.add("os-tab--muted");
      button.addEventListener("click", () => this._openTab(tab.key));
      button.addEventListener("keydown", (e) => this._onTabKey(e));
      list.append(button);
    }
    return list;
  }

  _tabLabelNode(tab, state) {
    const label = this._el("span", "os-tab-label");
    label.textContent = tab.label;
    const frag = document.createDocumentFragment();
    frag.append(label);
    if (tab.key === "specs") {
      const count = this.#detail === null ? 0 : this.#detail.specs.files.length;
      if (count > 0) {
        const badge = this._el("span", "os-tab-count");
        badge.textContent = String(count);
        frag.append(badge);
      }
    }
    if (tab.key === "tasks") {
      const tasks = this._knownTasks();
      if (tasks !== null) {
        const badge = this._el("span", "os-tab-count");
        badge.textContent = `${tasks.completed}/${tasks.total}`;
        frag.append(badge);
      }
    }
    if (state !== "present" && state !== "loading") {
      const mark = this._el("span", "os-tab-state");
      mark.textContent = state === "error" ? "!" : "\u2013";
      mark.title = state === "error" ? "read error" : "absent";
      frag.append(mark);
    }
    return frag;
  }

  // Task come li conosce l'elenco delle change: disponibili anche prima di
  // aprire la scheda Tasks (che legge tasks.md per il dettaglio).
  _knownTasks() {
    const state = this.#state;
    const name = this.#selected;
    if (state === null || state.kind !== "ready" || name === null) return null;
    const change = state.changes.find(c => c.name === name);
    if (change === undefined || !change.tasks || change.tasks.known !== true || change.tasks.total <= 0) return null;
    return change.tasks;
  }

  _tabState(tabKey) {
    if (this.#detail === null) return "loading";
    if (tabKey === "specs") return this.#detail.specs.state;
    const key = tabKey === "proposal" ? "proposal" : tabKey === "design" ? "design" : "tasks";
    return this.#detail.artifacts[key] ?? "unknown";
  }

  _onTabKey(event) {
    const keys = DOC_TABS.map(t => t.key);
    const index = keys.indexOf(this.#tab);
    let next = null;
    if (event.key === "ArrowRight") next = keys[(index + 1) % keys.length];
    else if (event.key === "ArrowLeft") next = keys[(index - 1 + keys.length) % keys.length];
    else if (event.key === "Home") next = keys[0];
    else if (event.key === "End") next = keys[keys.length - 1];
    if (next === null) return;
    event.preventDefault();
    this._openTab(next, { focus: true });
  }

  _openTab(tabKey, options = {}) {
    this.#tab = tabKey;
    if (tabKey !== "specs") this.#specIndex = 0;
    this._persistSelection();
    const panel = this._tabPanelNode();
    const current = this.#nodes.body.querySelector("#openspec-tabpanel");
    if (current !== null) {
      current.replaceWith(panel);
      // aggiorna lo stato aria-selected / tabindex delle schede
      for (const button of this.#nodes.body.querySelectorAll(".os-tab")) {
        const on = button.dataset.tab === tabKey;
        button.setAttribute("aria-selected", on ? "true" : "false");
        button.tabIndex = on ? 0 : -1;
      }
    } else {
      this._renderDetailOnly();
    }
    if (options.focus === true) {
      const button = this.#nodes.body.querySelector(`#openspec-tab-${tabKey}`);
      if (button !== null) button.focus();
    }
    this._loadTabContent(tabKey);
  }

  _loadTabContent(tabKey) {
    // Solo i documenti che l'elenco da' presenti si leggono: assente e' uno
    // stato dell'elenco, non un errore di lettura.
    const path = this._tabState(tabKey) === "present" ? this._docPathFor(tabKey) : null;
    if (path === null) {
      this.#doc = null;
      this._renderTabPanelContent();
      return;
    }
    const ctx = this.#context;
    const seq = ++this.#docSeq;
    this.#doc = { status: "loading", path };
    this._renderTabPanelContent();
    loadDoc(ctx, path)
      .then(doc => {
        if (seq !== this.#docSeq || ctx !== this.#context) return;
        if (this.#tab !== tabKey) return;
        this.#doc = { status: "ready", path, doc };
        this._renderTabPanelContent();
      })
      .catch(err => {
        if (seq !== this.#docSeq) return;
        this.#doc = { status: "error", path, error: errMessage(err) };
        this._renderTabPanelContent();
      });
  }

  _tabPanelNode() {
    const panel = this._el("div", "os-tabpanel");
    panel.id = "openspec-tabpanel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `openspec-tab-${this.#tab}`);
    panel.tabIndex = 0;
    this._fillTabPanel(panel);
    return panel;
  }

  _renderTabPanelContent() {
    const panel = this.#nodes.body.querySelector("#openspec-tabpanel");
    if (panel === null) return;
    panel.textContent = "";
    this._fillTabPanel(panel);
  }

  _fillTabPanel(panel) {
    if (this.#detail === null || this.#detailStatus !== "ready") return;
    if (this.#tab === "tasks") {
      this._fillTasks(panel);
      return;
    }
    if (this.#tab === "specs") this._fillSpecs(panel);

    const artifactKey = this.#tab === "specs" ? "specs" : this.#tab;
    const artifactState = this._tabState(artifactKey);
    const path = this._docPathFor(this.#tab);
    if (path === null) {
      panel.append(this._text("p os-empty", artifactState === "error"
        ? "Cannot read the specs directory."
        : "No spec files in this change."));
      if (this.#detail.specs.error) panel.append(this._text("p error", this.#detail.specs.error));
      return;
    }
    if (artifactState === "absent") {
      const label = DOC_TABS.find(t => t.key === this.#tab);
      panel.append(this._text("p os-empty", `No ${label ? label.file : "document"} in this change.`));
      return;
    }
    this._fillDoc(panel, path);
    if (this.#tab === "specs" && this.#detail.specs.truncated) {
      panel.append(this._text("p os-muted", `Only the first ${MAX_SPEC_FILES} spec files are listed.`));
    }
  }

  _fillDoc(panel, path) {
    const doc = this.#doc;
    if (doc === null || doc.path !== path) {
      panel.setAttribute("aria-busy", "true");
      panel.append(this._text("p os-muted", "Loading…"));
      return;
    }
    if (doc.status === "loading") {
      panel.setAttribute("aria-busy", "true");
      panel.append(this._text("p os-muted", "Loading…"));
      return;
    }
    panel.removeAttribute("aria-busy");
    if (doc.status === "error") {
      panel.append(this._text("p error-state", `Cannot read ${path}: ${doc.error}`));
      panel.append(this._docActions(path));
      return;
    }
    const inner = doc.doc;
    if (inner.state === "error") {
      panel.append(this._text("p error-state", `Cannot read ${path}: ${inner.error}`));
      panel.append(this._docActions(path));
      return;
    }
    if (inner.state === "binary") {
      panel.append(this._text("p error-state", `${path} is a binary file.`));
      return;
    }
    if (inner.state === "truncated") {
      panel.append(this._text("p os-empty", "File is truncated: showing the readable part."));
    }
    const article = this._el("article", "os-doc");
    article.append(renderMarkdown(inner.content));
    panel.append(article);
    panel.append(this._docActions(path));
  }

  _docActions(path) {
    const row = this._el("div", "os-doc-actions");
    const where = this._el("code", "os-doc-path");
    where.textContent = path;
    row.append(where);
    // Il pulsante esiste solo se l'host espone la navigazione: un pulsante che
    // non fa nulla e' peggio di nessun pulsante.
    if (this._canOpenInFiles()) {
      const open = this._el("button", "os-open-file");
      open.type = "button";
      open.textContent = "Open in Files";
      open.title = `Open ${path} in the Files panel`;
      open.addEventListener("click", () => this._openInFiles(path));
      row.append(open);
    }
    return row;
  }

  _canOpenInFiles() {
    const ctx = this.#context;
    return ctx !== null && typeof ctx.navigate === "function";
  }

  // Apre il documento nel pannello Files dell'host (stessa navigazione che usa
  // il plugin relays): tool `files:workspace.files`, query `file`.
  _openInFiles(path) {
    const ctx = this.#context;
    if (ctx === null || typeof ctx.navigate !== "function") return;
    let result;
    try {
      result = ctx.navigate({
        machineId: ctx.machine?.id,
        projectId: ctx.workspace?.projectId,
        workspaceId: ctx.workspace?.id,
        view: "workspace",
        tool: "files:workspace.files",
        query: { file: path },
      }, { mode: "patch" });
    } catch {
      return; // navigazione rifiutata in modo sincrono: il percorso resta visibile
    }
    // navigate ritorna una promise: un rifiuto non deve diventare un
    // unhandled rejection nella console del host.
    if (result !== null && typeof result === "object" && typeof result.then === "function") {
      result.then(undefined, () => {});
    }
  }

  _fillSpecs(panel) {
    const specs = this.#detail.specs;
    if (specs.files.length === 0) return; // gestito da _fillTabPanel
    // Il file selezionato puo' essere sparito (change modificata nel frattempo).
    if (this.#specIndex >= specs.files.length) this.#specIndex = 0;
    const nav = this._el("nav", "os-spec-nav");
    nav.setAttribute("aria-label", "Spec files");
    specs.files.forEach((file, index) => {
      const button = this._el("button", index === this.#specIndex ? "os-spec os-spec--on" : "os-spec");
      button.type = "button";
      button.textContent = `${file.capability}/${file.name}`;
      button.setAttribute("aria-current", index === this.#specIndex ? "true" : "false");
      button.addEventListener("click", () => {
        this.#specIndex = index;
        this.#doc = null;
        this._persistSelection();
        this._renderTabPanelContent();
        this._loadTabContent("specs");
      });
      nav.append(button);
    });
    panel.append(nav);
  }

  _taskSummary() {
    if (this.#detail === null) return null;
    const doc = this.#doc;
    const path = `${CHANGES_DIR}/${this.#detail.name}/tasks.md`;
    if (doc === null || doc.path !== path || doc.status !== "ready" || doc.doc.state === "binary") return null;
    const groups = parseTaskItems(doc.doc.content);
    const total = groups.reduce((n, g) => n + g.total, 0);
    const completed = groups.reduce((n, g) => n + g.completed, 0);
    return { groups, total, completed };
  }

  _fillTasks(panel) {
    const artifactState = this._tabState("tasks");
    if (artifactState === "absent") {
      panel.append(this._text("p os-empty", "No tasks.md in this change."));
      return;
    }
    if (artifactState === "unknown") {
      panel.append(this._text("p error-state", "Cannot read tasks.md."));
      return;
    }
    const path = this._docPathFor("tasks");
    const doc = this.#doc;
    if (doc === null || doc.path !== path || doc.status === "loading") {
      // Il caricamento lo avvia _openTab (uno solo): innescarlo anche qui
      // annullava la risposta in volo e lasciava a schermo il testo vecchio.
      panel.setAttribute("aria-busy", "true");
      panel.append(this._text("p os-muted", "Loading…"));
      return;
    }
    panel.removeAttribute("aria-busy");
    if (doc.status === "error") {
      panel.append(this._text("p error-state", `Cannot read ${path}: ${doc.error}`));
      panel.append(this._docActions(path));
      return;
    }
    if (doc.doc.state === "error") {
      panel.append(this._text("p error-state", `Cannot read ${path}: ${doc.doc.error}`));
      panel.append(this._docActions(path));
      return;
    }
    if (doc.doc.state === "binary") {
      panel.append(this._text("p error-state", `${path} is a binary file.`));
      return;
    }
    const summary = this._taskSummary();
    if (summary === null) {
      panel.append(this._text("p os-muted", "Loading…"));
      return;
    }
    if (summary.total === 0) {
      panel.append(this._text("p os-empty", "tasks.md has no checklist items."));
      panel.append(this._docActions(path));
      return;
    }
    const pct = Math.round((100 * summary.completed) / summary.total);
    const head = this._el("div", "os-task-summary");
    const count = this._el("b");
    count.textContent = `${summary.completed} / ${summary.total}`;
    const rest = this._el("span");
    rest.textContent = ` tasks done (${summary.total - summary.completed} left, ${pct}%)`;
    head.append(count, rest);
    panel.append(head);
    panel.append(this._progressNode({ known: true, completed: summary.completed, total: summary.total }));

    const list = this._el("div", "os-task-groups");
    for (const group of summary.groups) {
      const section = this._el("section", "os-task-group");
      const h = this._el("h3", "os-task-group-head");
      const gname = this._el("span");
      gname.textContent = group.name;
      const gcount = this._el("span", "os-tab-count");
      gcount.textContent = `${group.completed}/${group.total}`;
      h.append(gname, gcount);
      section.append(h);
      if (group.items.length === 0) {
        section.append(this._text("p os-muted", "No tasks in this section."));
      } else {
        const ul = this._el("ul", "os-task-list");
        for (const item of group.items) {
          const li = this._el("li", item.done ? "os-task os-task--done" : "os-task");
          const box = this._el("span", "os-check");
          box.setAttribute("aria-hidden", "true");
          box.textContent = item.done ? "\u2611" : "\u2610";
          const text = this._el("span", "os-task-text");
          text.textContent = item.text;
          li.append(box, text);
          if (item.done) li.title = "done";
          ul.append(li);
        }
        section.append(ul);
      }
      list.append(section);
    }
    panel.append(list);
    panel.append(this._docActions(path));
  }
}

// Registro dei pannelli montati, per il force refresh su invalidation.
export function refreshMountedPanels(context) {
  for (const el of mountedElements) {
    try {
      if (el.isConnected && el.matchesContext(context)) {
        el._forceRefresh();
      }
    } catch {}
  }
}

// Badge: lettura sincrona dalla cache (host chiama badge() in modo sync).
export function getOpenSpecBadge(context) {
  try {
    const entry = cache.get(openSpecKey(context));
    if (entry && entry.state && entry.state.kind === "ready") {
      return entry.state.changes.length > 0 ? entry.state.changes.length : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// Icona del pannello (clipboard con spunta), usata nell'intestazione.
const PANEL_ICON = [
  "M9 4h6v3H9z",
  "M7 5.5H6a1 1 0 00-1 1V19a1 1 0 001 1h12a1 1 0 001-1V6.5a1 1 0 00-1-1h-1",
  "M9 12h6M9 15.5h6",
];

const SVG_NS = "http://www.w3.org/2000/svg";

function buildIcon(paths, color) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.style.stroke = color || "currentColor"; // style: var() negli attributi SVG non e' portabile
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

// ───────────────────────────────────────────────────────────────────────────
// Entry: PI WEB plugin v5 (browser-only)
// ───────────────────────────────────────────────────────────────────────────
const ELEMENTS = [[PANEL_TAG, OpenspecPanelElement]];

async function activate(context) {
  if (typeof customElements !== "undefined") {
    // Idempotente: su una ri-attivazione il costruttore registrato e' quello
    // del modulo precedente. Ridefinirlo lancia e lascerebbe il pannello
    // sparito fino al reload, quindi si riusa quello gia' presente.
    for (const [tag, ctor] of ELEMENTS) {
      if (customElements.get(tag) === undefined) customElements.define(tag, ctor);
    }
  }

  const { html, svg } = context;
  return {
    contributions: {
      workspacePanels: [{
        id: "openspec-status",
        title: "OpenSpec",
        order: 90,
        icon: svg `<svg viewBox="0 0 24 24" fill="none" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6"/><path d="M8 12.5 11 15 14.5 9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        badge: c => getOpenSpecBadge(c),
        visible: c => c.workspace !== undefined,
        invalidationResources: ["workspace.files"],
        // Il force refresh e' coalesced nella cache per workspace.
        onInvalidate: c => refreshMountedPanels(c),
        render: r => html`<openspec-status-panel .context=${r}></openspec-status-panel>`,
      }],
    },
  };
}

export { OpenspecPanelElement, PANEL_TAG };
export { activate };

// Il contratto PiWebPluginV5 vuole un OGGETTO default {apiVersion, name, activate}:
// un export default che è la sola funzione viene rifiutato dal host senza
// errori visibili (validazione: apiVersion===5 && typeof name=="string" &&
// typeof activate=="function").
export default {
  apiVersion: 5,
  name: "OpenSpec Status",
  activate,
};
