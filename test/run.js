// Suite test del plugin OpenStatus-web (browser-only, v5).
// Esecuzione: node --test test/run.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────────────
// 1) Installa lo stub DOM PRIMA di importare il plugin: la classe del
//    pannello estende HTMLElement e lega il global al momento dell'import.
// ──────────────────────────────────────────────────────────────────────
const { createDomStub } = await import("./dom-stub.js");
const { document: stubDocument, HTMLElement: stubHTMLElement } = createDomStub();
globalThis.document = stubDocument;
globalThis.HTMLElement = stubHTMLElement;
globalThis.customElements = (() => {
  const map = new Map();
  return {
    define: (tag, cls) => {
      map.set(tag, cls);
      return cls;
    },
    get: (tag) => map.has(tag) ? map.get(tag) : undefined,
  };
})();

// ──────────────────────────────────────────────────────────────────────
// 2) Importa il plugin (src: la build è una copia bit-for-bit di src)
// ──────────────────────────────────────────────────────────────────────
const root = fileURLToPath(new URL("..", import.meta.url));
const fix = (name) => join(root, "fixtures", name);

const plugin = await import("../src/pi-web-plugin.js");
const {
  parseTaskGroups,
  classifyArtifacts,
  loadOpenSpecState,
  OpenspecPanelElement,
  refreshMountedPanels,
  getOpenSpecBadge,
  parseTaskItems,
  renderMarkdown,
  loadChangeDetail,
  loadDoc,
  inspectChangeValidity,
} = plugin;
const activateModule = plugin.default;
const activateFn = activateModule.activate;
const { createFsFromDir, createMockFs, createContext, settle, tick } = await import("./fs-mock.js");

// ──────────────────────────────────────────────────────────────────────
// Helper comuni
// ──────────────────────────────────────────────────────────────────────
function makeElement() {
  const el = new OpenspecPanelElement();
  el.isConnected = true;
  el.connectedCallback();
  return el;
}

async function renderWith(fs, workspaceId) {
  const ctx = createContext(fs, workspaceId);
  const el = makeElement();
  el.context = ctx;
  await settle();
  return { el, ctx, fs, state: el.state };
}

async function renderDisk(name) {
  const fs = await createFsFromDir(fix(name));
  return renderWith(fs, name);
}

// ──────────────────────────────────────────────────────────────────────
// Parser
// ──────────────────────────────────────────────────────────────────────
describe("parseTaskGroups", () => {
  test("fixture os-partial -> 7/14, 6 gruppi", async () => {
    const content = readFileSync(fix("os-partial/openspec/changes/demo-partial-change/tasks.md"), "utf8");
    const groups = parseTaskGroups(content);
    // 6 sezioni "## ": 4 gruppi di task + 2 sezioni risultati/ output
    // ("Risultati", "Preflight output") prive di task -> empty.
    assert.strictEqual(groups.length, 6);
    assert.strictEqual(groups.reduce((n, g) => n + g.total, 0), 14);
    assert.strictEqual(groups.reduce((n, g) => n + g.completed, 0), 7);
    assert.deepStrictEqual(groups.map((g) => g.status), ["complete", "partial", "none", "none", "empty", "empty"]);
  });

  test("testo vuoto / null / non-stringa -> []", () => {
    assert.deepStrictEqual(parseTaskGroups(""), []);
    assert.deepStrictEqual(parseTaskGroups(null), []);
    assert.deepStrictEqual(parseTaskGroups(123), []);
  });

  test("nessun heading '## ' -> []", () => {
    const s = "# titolo\ntest\n- [x] orfano\n##?\n- [x] orfano2";
    assert.deepStrictEqual(parseTaskGroups(s), []);
  });

  test("testo prima del primo heading ignorato", () => {
    const s = "- [x] prima\n## G\n- [x] a\n- [ ] b\n";
    const g = parseTaskGroups(s)[0];
    assert.strictEqual(g.completed, 1);
    assert.strictEqual(g.total, 2);
  });

  test("hardening: contenuti di code fence non conteggiati", () => {
    const s = "## G\n```text\n- [x] fence1\n- [ ] fence2\n```\n- [x] vero\n- [ ] vero2\n";
    const g = parseTaskGroups(s)[0];
    assert.deepStrictEqual(g, { name: "G", completed: 1, total: 2, status: "partial" });
  });

  test("hardening: fence con tilde", () => {
    const s = "## G\n~~~\n- [x] t1\n~~~\n- [ ] t2\n- [x] t3\n";
    const g = parseTaskGroups(s)[0];
    // t1 è dentro il fence e va saltato; contano solo t2 e t3.
    assert.strictEqual(g.completed, 1);
    assert.strictEqual(g.total, 2);
  });

  test("CRLF normalizzato", () => {
    const g = parseTaskGroups("## G\r\n- [x] a\r\n- [ ] b\r\n")[0];
    assert.deepStrictEqual(g, { name: "G", completed: 1, total: 2, status: "partial" });
  });

  test("subsectioni '### ' non contano come gruppi", () => {
    const s = "## A\n### B\n- [x] x1\n- [x] x2\n### C\n- [ ] y\n## B2\n- [x] z\n";
    const groups = parseTaskGroups(s);
    assert.strictEqual(groups.length, 2);
    assert.deepStrictEqual(groups.map((g) => [g.name, g.completed, g.total]), [["A", 2, 3], ["B2", 1, 1]]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// classifyArtifacts
// ──────────────────────────────────────────────────────────────────────
describe("classifyArtifacts", () => {
  test("tutto presente -> specs null (da sondare) ", () => {
    const e = [
      { name: "proposal.md", type: "file" },
      { name: "design.md", type: "file" },
      { name: "specs", type: "directory" },
      { name: "tasks.md", type: "file" },
    ];
    assert.deepStrictEqual(classifyArtifacts(e), { proposal: "present", design: "present", specs: null, tasks: "present" });
  });

  test("tutto assente", () => {
    assert.deepStrictEqual(classifyArtifacts([]), { proposal: "absent", design: "absent", specs: "absent", tasks: "absent" });
  });
});

// ──────────────────────────────────────────────────────────────────────
// State machine su fixture reali
// ──────────────────────────────────────────────────────────────────────
describe("loadOpenSpecState — fixture", () => {
  test("workspace senza openspec/ -> not-found", async () => {
    const { state } = await renderDisk("no-openspec");
    // no-openspec è vuoto -> lista di "openspec" fallisce -> not-found
    assert.strictEqual(state.kind, "not-found");
  });

  test("no-active -> kind no-active + archiveCount 1", async () => {
    const { state } = await renderDisk("os-no-active");
    assert.strictEqual(state.kind, "no-active");
    assert.strictEqual(state.archiveCount, 1);
  });

  test("partial -> ready, artefatti P/D/T + tasks 7/14", async () => {
    const { state } = await renderDisk("os-partial");
    assert.strictEqual(state.kind, "ready");
    assert.deepStrictEqual(state.changes, [{
      name: "demo-partial-change",
      artifacts: { proposal: "present", design: "present", specs: "absent", tasks: "present" },
      tasks: { completed: 7, total: 14, known: true },
      error: null,
    }]);
  });

  test("multi -> 3 change con stati diversi", async () => {
    const { state } = await renderDisk("os-multi");
    assert.strictEqual(state.kind, "ready");
    assert.strictEqual(state.changes.length, 3);
    const byName = new Map(state.changes.map((c) => [c.name, c]));
    const alpha = byName.get("change-alpha");
    const beta = byName.get("change-beta");
    const gamma = byName.get("change-gamma");
    assert.deepStrictEqual(alpha.artifacts, { proposal: "present", design: "absent", specs: "absent", tasks: "present" });
    assert.deepStrictEqual(alpha.tasks, { completed: 3, total: 4, known: true });
    assert.deepStrictEqual(beta.artifacts, { proposal: "absent", design: "absent", specs: "absent", tasks: "absent" });
    assert.deepStrictEqual(gamma.artifacts, { proposal: "present", design: "present", specs: "present", tasks: "present" });
    assert.deepStrictEqual(gamma.tasks, { completed: 1, total: 2, known: true });
    // change-beta senza tasks.md è uno stato normale: nessun errore segnalato.
    assert.deepStrictEqual(state.errors, []);
  });

  test("worktree -> wt-feature 1/3", async () => {
    const { state } = await renderDisk("os-worktree");
    assert.strictEqual(state.kind, "ready");
    const c = state.changes[0];
    assert.strictEqual(c.name, "wt-feature");
    assert.deepStrictEqual(c.artifacts, { proposal: "present", design: "absent", specs: "absent", tasks: "present" });
    assert.deepStrictEqual(c.tasks, { completed: 1, total: 3, known: true });
  });

  test("malformed -> difensivo: prima heading e fence ignorati, 1/1 complete", async () => {
    const { state } = await renderDisk("os-malformed");
    assert.strictEqual(state.kind, "ready");
    const c = state.changes[0];
    assert.strictEqual(c.name, "bad-tasks");
    assert.deepStrictEqual(c.artifacts, { proposal: "present", design: "absent", specs: "absent", tasks: "present" });
    assert.deepStrictEqual(c.tasks, { completed: 1, total: 1, known: true });
  });
});

// ──────────────────────────────────────────────────────────────────────
// State machine su mock sintetico (errori + truncation)
// ──────────────────────────────────────────────────────────────────────
const partialTree = {
  "openspec": { type: "directory" },
  "openspec/changes": { type: "directory" },
  "openspec/changes/alpha": { type: "directory" },
  "openspec/changes/alpha/proposal.md": { type: "file", size: 1 },
  "openspec/changes/alpha/tasks.md": { type: "file", size: 40 },
};

describe("loadOpenSpecState — sintetico", () => {
  test("openspec/ assente (reject) -> not-found", async () => {
    const fs = createMockFs({ rejectPaths: ["openspec"] });
    const ctx = createContext(fs, "ws-syn-1");
    const res = await loadOpenSpecState(ctx);
    assert.strictEqual(res.state.kind, "not-found");
  });

  test("changes/ rifiutato -> kind error + messaggio (nessuno stato precedente da riusare)", async () => {
    const fs = createMockFs({ tree: partialTree, rejectPaths: ["openspec/changes"] });
    const ctx = createContext(fs, "ws-syn-2");
    const res = await loadOpenSpecState(ctx);
    assert.strictEqual(res.state.kind, "error");
    assert.ok(res.state.error.includes("ENOENT"));
    assert.deepStrictEqual(res.state.changes, []);
  });

  test("tasks.md troncata -> known false + entry in errors", async () => {
    const fs = createMockFs({
      tree: partialTree,
      contents: { "openspec/changes/alpha/tasks.md": "## T\n- [x] t1\n- [ ] t2\n" },
      truncatedReads: ["openspec/changes/alpha/tasks.md"],
    });
    const ctx = createContext(fs, "ws-syn-3");
    const res = await loadOpenSpecState(ctx);
    assert.strictEqual(res.state.kind, "ready");
    const c = res.state.changes[0];
    assert.strictEqual(c.tasks.known, false);
    assert.ok(c.tasks.error.includes("truncated"));
    assert.ok(res.state.errors.some((e) => e.includes("truncated")));
  });
});

// ──────────────────────────────────────────────────────────────────────
// Cache
// ──────────────────────────────────────────────────────────────────────
describe("cache", () => {
  const makeCtx = (wsId) => createContext(createMockFs({ tree: partialTree, contents: { "openspec/changes/alpha/tasks.md": "## T\n- [x] t1\n" } }), wsId);

  test("seconda chiamata nel TTL -> cacheHit, nessun nuovo fetch", async () => {
    const ctx = makeCtx("cache-1");
    const a = await loadOpenSpecState(ctx);
    assert.strictEqual(a.cacheHit, false);
    const fs = ctx.files;
    const c0 = fs.calls.list + fs.calls.read;
    const b = await loadOpenSpecState(ctx);
    assert.strictEqual(b.cacheHit, true);
    assert.strictEqual(fs.calls.list + fs.calls.read, c0);
  });

  test("due chiamate concorrenti -> coalesced in un solo fetch", async () => {
    const ctx = makeCtx("cache-2");
    const a = loadOpenSpecState(ctx);
    const b = loadOpenSpecState(ctx);
    // Coalescing: entrambi restano sullo stesso Promise in flight.
    assert.strictEqual(a, b);
    const res = await a;
    assert.strictEqual(res.cacheHit, false);
    assert.strictEqual(res.state.kind, "ready");
    assert.strictEqual(res.state.changes[0].name, "alpha");
    const c1 = ctx.files.calls.list + ctx.files.calls.read;
    // Terza chiamata nel TTL: cache hit, stesso oggetto stato, zero fetch.
    const res2 = await loadOpenSpecState(ctx);
    assert.strictEqual(res2.state, res.state);
    assert.strictEqual(ctx.files.calls.list + ctx.files.calls.read, c1);
  });

  test("force -> nuovo fetch", async () => {
    const ctx = makeCtx("cache-3");
    await loadOpenSpecState(ctx);
    const c0 = ctx.files.calls.list + ctx.files.calls.read;
    const r = await loadOpenSpecState(ctx, { force: true });
    assert.strictEqual(r.cacheHit, false);
    assert.strictEqual(ctx.files.calls.list + ctx.files.calls.read > c0, true);
  });

  test("TTL scaduto -> refetch (seam setActiveTtlMs)", async () => {
    const saved = plugin.getActiveTtlMs();
    try {
      plugin.setActiveTtlMs(-1);
      const ctx = makeCtx("cache-4");
      await loadOpenSpecState(ctx);
      const c0 = ctx.files.calls.list + ctx.files.calls.read;
      const r = await loadOpenSpecState(ctx);
      assert.strictEqual(r.cacheHit, false);
      assert.strictEqual(ctx.files.calls.list + ctx.files.calls.read > c0, true);
    } finally {
      plugin.setActiveTtlMs(saved);
    }
  });

  test("cache separata per workspace", async () => {
    const fs = createMockFs({ tree: partialTree, contents: { "openspec/changes/alpha/tasks.md": "## T\n- [x] t1\n" } });
    const ctx1 = createContext(fs, "cache-sep-1");
    const ctx2 = createContext(fs, "cache-sep-2");
    await loadOpenSpecState(ctx1);
    const c0 = fs.calls.list + fs.calls.read;
    await loadOpenSpecState(ctx2);
    assert.strictEqual(fs.calls.list + fs.calls.read > c0, true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Rendering DOM
// ──────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────
// Tetti di robustezza: limite ai change letti dal pannello.
// ──────────────────────────────────────────────────────────────────────
describe("tetti di robustezza", () => {
  test("piu' di 40 change attivi -> pannello limitato a 40 + truncated", async () => {
    const tree = {
      "openspec": { type: "directory" },
      "openspec/changes": { type: "directory" },
    };
    for (let i = 0; i < 45; i++) {
      const n = `c${String(i).padStart(3, "0")}`;
      tree[`openspec/changes/${n}`] = { type: "directory" };
      tree[`openspec/changes/${n}/proposal.md`] = { type: "file", size: 1 };
    }
    const ctx = createContext(createMockFs({ tree }), "cap-1");
    const res = await loadOpenSpecState(ctx);
    assert.strictEqual(res.state.kind, "ready");
    assert.strictEqual(res.state.changes.length, 40, "INDEX_MAX_CHANGES = 40");
    assert.strictEqual(res.state.truncated, true);
  });

});

describe("pannello DOM", () => {
  test("not-found -> testo vuoto + badge assente", async () => {
    const fs = createMockFs({ rejectPaths: ["openspec"] });
    const { el } = await renderWith(fs, "dom-1");
    const body = el.shadowRoot.querySelector("#openspec-body");
    assert.ok(body.textContent.includes("No OpenSpec project"));
    // Regressione: il messaggio compariva due volte (corpo + box errore rosso).
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-error").hidden, true);
    // Regressione: la sintesi in testa duplicava i dati della card ed e' stata rimossa.
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-sub"), null);
    const badge = el.shadowRoot.querySelector("#openspec-badge");
    assert.strictEqual(badge.hidden, true);
    assert.strictEqual(badge.textContent, "");
  });

  test("no-active -> testo + count archivi", async () => {
    const fs = await createFsFromDir(fix("os-no-active"));
    const { el } = await renderWith(fs, "dom-2");
    const body = el.shadowRoot.querySelector("#openspec-body");
    assert.ok(body.textContent.includes("No active changes"));
    assert.ok(body.textContent.includes("(1 archived)"));
  });

  test("partial -> righe, artefatti, tasks, badge, stamp", async () => {
    const fsP = await createFsFromDir(fix("os-partial"));
    const { el } = await renderWith(fsP, "dom-3");
    const change = el.shadowRoot.querySelector(".change");
    assert.notEqual(change, null);
    assert.strictEqual(el.shadowRoot.querySelector(".change .name").textContent, "demo-partial-change");

    const arts = el.shadowRoot.querySelectorAll(".change .artifact");
    assert.strictEqual(arts.length, 4);
    // Lo stato lo dicono i colori (niente glifi nei chip), piu' data-state.
    assert.deepStrictEqual(arts.map((a) => a.textContent), ["Proposal", "Design", "Specs", "Tasks"]);
    assert.deepStrictEqual(arts.map((a) => a.getAttribute("data-state")), ["present", "present", "absent", "present"]);
    assert.deepStrictEqual(arts.map((a) => a.className.includes("artifact--")), [true, true, true, true]);

    assert.strictEqual(el.shadowRoot.querySelector(".change .tasks").textContent, "7 / 14 (50%)");

    const badge = el.shadowRoot.querySelector("#openspec-badge");
    assert.strictEqual(badge.textContent, "1");
    assert.strictEqual(badge.hidden, false);

    assert.strictEqual(el.shadowRoot.querySelector("#openspec-error").hidden, true);
    assert.notEqual(el.shadowRoot.querySelector(".stamp").textContent.trim(), "");
  });

  test("multi -> 3 righe + badge 3", async () => {
    const fsM = await createFsFromDir(fix("os-multi"));
    const { el } = await renderWith(fsM, "dom-4");
    const rows = el.shadowRoot.querySelectorAll(".change");
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(rows.map((r) => r.querySelector(".name").textContent), ["change-alpha", "change-beta", "change-gamma"]);
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-badge").textContent, "3");
    // change-beta non ha tasks.md: stato normale, nessun errore in vista.
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-error").hidden, true);
    const taskCells = el.shadowRoot.querySelectorAll(".change .tasks");
    // change-alpha: 3/4, change-beta: nessun tasks.md (–), change-gamma: 1/2.
    assert.deepStrictEqual(taskCells.map((t) => t.textContent), ["3 / 4 (75%)", "–", "1 / 2 (50%)"]);
  });

  test("error -> errorBox visibile + corpo", async () => {
    const fs = createMockFs({ tree: { ...partialTree }, rejectPaths: ["openspec/changes"] });
    const { el } = await renderWith(fs, "dom-5");
    const err = el.shadowRoot.querySelector("#openspec-error");
    assert.strictEqual(err.hidden, false);
    assert.ok(err.textContent.includes("OpenSpec read error"));
    assert.ok(el.shadowRoot.querySelector("#openspec-body").textContent.includes("OpenSpec read error"));
  });

  test("truncated -> footer con warning", async () => {
    const fs = createMockFs({
      tree: partialTree,
      contents: { "openspec/changes/alpha/tasks.md": "## T\n- [x] t1\n" },
      truncatedPaths: ["openspec/changes"],
    });
    const { el } = await renderWith(fs, "dom-6");
    assert.ok(el.shadowRoot.querySelector(".stamp").textContent.includes("(list truncated)"));
  });

  test("invalidation -> refresh forzato (nuovi fetch)", async () => {
    const fs = createMockFs({ tree: partialTree, contents: { "openspec/changes/alpha/tasks.md": "## T\n- [x] t1\n" } });
    const ctx = createContext(fs, "dom-7");
    const el = makeElement();
    el.context = ctx;
    await settle();
    const c0 = fs.calls.list + fs.calls.read;
    refreshMountedPanels(ctx);
    await settle();
    assert.strictEqual(fs.calls.list + fs.calls.read > c0, true);
    el.disconnectedCallback();
  });

  test("invalidation non attraversa le macchine (stesso workspace.id)", async () => {
    const fs = createMockFs({ tree: partialTree, contents: { "openspec/changes/alpha/tasks.md": "## T\n- [x] t1\n" } });
    const ctxA = createContext(fs, "mach-a");
    const ctxB = { ...createContext(fs, "mach-a"), machine: { id: "other", label: "other" } };
    const el = makeElement();
    el.context = ctxA;
    await settle();
    const c0 = fs.calls.list + fs.calls.read;
    refreshMountedPanels(ctxB); // macchina diversa, stesso workspace.id: nessun refresh
    await settle();
    assert.strictEqual(fs.calls.list + fs.calls.read, c0);
    refreshMountedPanels(ctxA); // stessa macchina: refresh
    await settle();
    assert.ok(fs.calls.list + fs.calls.read > c0);
    el.disconnectedCallback();
  });

  test("disconnessione prima della risposta -> nessun render", async () => {
    // fs lento: il load dura D ms; si disconnette a D/3, quindi il render
    // viene bloccato dal guard generation/isConnected.
    const d = 300;
    const fast = createMockFs({ tree: partialTree, contents: { "openspec/changes/alpha/tasks.md": "## T\n- [x] t1\n" } });
    const slowFs = {
      ...fast,
      listFiles: async (p) => { await new Promise(r => setTimeout(r, d / 2)); return fast.listFiles(p); },
      readFile: async (p) => { await new Promise(r => setTimeout(r, d / 2)); return fast.readFile(p); },
    };
    const ctx = createContext(slowFs, "dom-8");
    const el = makeElement();
    el.context = ctx;
    // attendi che il load sia in flight, poi disconnette prima che risponda
    await new Promise(r => setTimeout(r, d / 3));
    el.isConnected = false;
    el.disconnectedCallback();
    // attesi che il render (bloccato) non produca nulla
    await new Promise(r => setTimeout(r, d + 100));
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-body").children.length, 0);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe("stili e layout", () => {
  test("ogni elemento crea uno shadow root con il proprio <style>", async () => {
    await activateFn({ html: (s) => s, svg: (s) => s });
    const el = makeElement();
    const root = el.shadowRoot;
    assert.ok(root, "il pannello deve avere uno shadow root");
    const style = root.querySelector("style");
    assert.ok(style, "lo <style> deve stare dentro lo shadow root");
    // Regressione: uno <style> in document.head non attraversa lo shadow root,
    // per questo il pannello risultava senza impaginazione.
    assert.strictEqual(globalThis.document.getElementById("openspec-status-styles"), null);
    const css = style.textContent;
    assert.ok(/\.os-header\s*\{[^}]*display:\s*flex/.test(css), "l'intestazione deve essere una riga flex");
    assert.ok(/\.os-header\s*\{[^}]*gap:/.test(css), "l'intestazione deve avere un gap");
    assert.ok(/\.change\s*\{[^}]*gap:/.test(css), "le righe change devono avere un gap");
    assert.ok(/\.artifacts\s*\{[^}]*gap:/.test(css), "gli artefatti devono avere un gap");
    assert.ok(/\.os-progress\s*\{[^}]*height:/.test(css), "la progress bar deve avere un'altezza");
    assert.ok(/\.os-progress-fill\s*\{/.test(css), "la progress bar deve avere un riempimento");
    assert.ok(/\.os-metrics\s*\{[^}]*display:\s*flex/.test(css), "le metriche devono essere su riga");
  });

});

describe("activate", () => {
  test("shape modulo v5: apiVersion 5 + name + activate", async () => {
    assert.strictEqual(activateModule.apiVersion, 5);
    assert.strictEqual(typeof activateModule.name, "string");
    assert.strictEqual(typeof activateModule.activate, "function");
  });

  test("shape contributions + customElements", async () => {
    const ctx = {
      html: () => ({ type: "TemplateResult", value: "" }),
      svg: () => ({ type: "TemplateResult", value: "" }),
    };
    const result = await activateFn(ctx);
    const panels = result.contributions.workspacePanels;
    assert.strictEqual(panels.length, 1);
    const p = panels[0];
    assert.strictEqual(p.id, "openspec-status");
    assert.strictEqual(p.title, "OpenSpec");
    assert.strictEqual(p.order, 90);
    assert.ok(typeof p.render === "function");
    assert.ok(Array.isArray(p.invalidationResources) && p.invalidationResources.includes("workspace.files"));
    assert.ok(typeof p.onInvalidate === "function");
    assert.ok(typeof p.badge === "function");
    assert.ok(typeof p.visible === "function");
    assert.strictEqual(p.visible({ workspace: {} }), true);
    assert.strictEqual(p.visible({}), false);
    assert.strictEqual(customElements.get("openspec-status-panel"), plugin.OpenspecPanelElement);

    // workspaceLabels non c'e' piu': il client la monta solo nelle righe della
    // sezione WORKSPACES, che nel layout reale non viene renderizzata.
    assert.strictEqual(result.contributions.workspaceLabels, undefined);

  });

  test("badge su cache vuota -> undefined", () => {
    assert.strictEqual(getOpenSpecBadge({ machine: { id: "m" }, workspace: { id: "w" } }), undefined);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Igiene del pacchetto e comportamenti di bordo
// ──────────────────────────────────────────────────────────────────────
describe("pacchetto", () => {
  test("dist e' byte-identico a src (nessuna build dimenticata)", async () => {
    const a = readFileSync(join(root, "src", "pi-web-plugin.js"), "utf8");
    const b = readFileSync(join(root, "dist", "pi-web-plugin.js"), "utf8");
    assert.strictEqual(b, a, "dist/ non allineato: eseguire node scripts/build.mjs");
  });
});

describe("bordi della lettura", () => {
  test("un artefatto symlink non risulta assente", () => {
    // FileTreeEntry.type ammette "symlink": un proposal o una specs/ linkati
    // devono contare come presenti, altrimenti la change sembra vuota.
    const arts = classifyArtifacts([
      { name: "proposal.md", type: "symlink" },
      { name: "specs", type: "symlink" },
      { name: "tasks.md", type: "symlink" },
    ]);
    assert.strictEqual(arts.proposal, "present");
    assert.strictEqual(arts.tasks, "present");
    assert.strictEqual(arts.design, "absent");
    assert.strictEqual(arts.specs, null, "specs/ presente: va sondato per il contenuto");
  });

  test("tasks.md binario -> conteggio sconosciuto, non zero", async () => {
    const fs = await createFsFromDir(fix("os-partial"));
    const realRead = fs.readFile.bind(fs);
    fs.readFile = async (p) => {
      const r = await realRead(p);
      return p.endsWith("tasks.md") ? { ...r, binary: true, content: "" } : r;
    };
    const { state } = await renderWith(fs, "edge-binary");
    const ch = state.changes[0];
    assert.strictEqual(ch.tasks.known, false);
    assert.ok(/binary/.test(ch.tasks.error), ch.tasks.error);
  });

  test("errorBox: tre voci in vista, il resto contato e nel title", async () => {
    const tree = { openspec: { type: "directory" }, "openspec/changes": { type: "directory" } };
    const contents = {};
    for (let i = 0; i < 5; i++) {
      tree[`openspec/changes/c${i}`] = { type: "directory" };
      tree[`openspec/changes/c${i}/tasks.md`] = { type: "file" };
      contents[`openspec/changes/c${i}/tasks.md`] = "## T\n- [x] a\n";
    }
    const fs = createMockFs({ tree, contents, truncatedReads: Object.keys(contents) });
    const { el } = await renderWith(fs, "edge-errors");
    const box = el.shadowRoot.querySelector("#openspec-error");
    assert.strictEqual(box.hidden, false);
    assert.ok(box.textContent.includes("… and 2 more"), box.textContent);
    assert.strictEqual(box.title.split("\n").length, 5);
  });

  test("contesti parziali diversi non condividono la cache", async () => {
    const fs = createMockFs({ rejectPaths: ["openspec"] });
    const a = { files: fs };          // senza machine/workspace
    const b = { files: fs };
    const ra = await loadOpenSpecState(a);
    const rb = await loadOpenSpecState(b);
    assert.notStrictEqual(ra.state, rb.state, "stati distinti per contesti distinti");
  });

  test("activate e' idempotente: una seconda chiamata non lancia", async () => {
    const ctx = { html: () => ({ type: "TemplateResult" }), svg: () => ({ type: "TemplateResult" }) };
    await activateFn(ctx);
    await activateFn(ctx);
    assert.strictEqual(customElements.get("openspec-status-panel"), plugin.OpenspecPanelElement);
  });
});


// ──────────────────────────────────────────────────────────────────────
// Dashboard operativa: item dei task, markdown, dettaglio, tab, refresh
// ──────────────────────────────────────────────────────────────────────
describe("parseTaskItems", () => {
  test("gruppi con voci e stato, stessa semantica del conteggio", () => {
    const md = "## 1. Gate\n- [x] a\n- [ ] b\n\n## 2. Nulla\n- [x] c\n";
    const groups = parseTaskItems(md);
    assert.strictEqual(groups.length, 2);
    assert.deepStrictEqual(groups[0].items.map(i => [i.text, i.done]), [["a", true], ["b", false]]);
    assert.strictEqual(groups[0].completed, 1);
    assert.strictEqual(groups[0].total, 2);
    assert.strictEqual(groups[0].status, "partial");
    assert.strictEqual(groups[1].total, 1);
  });

  test("le checkbox dentro i blocchi di codice non contano", () => {
    const md = "## G\n```text\n- [x] finta\n```\n- [x] vera\n";
    const groups = parseTaskItems(md);
    assert.deepStrictEqual(groups[0].items.map(i => i.text), ["vera"]);
  });

  test("conteggio e item restano coerenti sulla fixture reale", async () => {
    const content = readFileSync(fix("os-partial/openspec/changes/demo-partial-change/tasks.md"), "utf8");
    const groups = parseTaskItems(content);
    const counted = parseTaskGroups(content);
    assert.strictEqual(groups.length, counted.length);
    assert.deepStrictEqual(groups.map(g => [g.completed, g.total]), counted.map(g => [g.completed, g.total]));
  });
});

describe("renderMarkdown", () => {
  const render = (md) => {
    const host = globalThis.document.createElement("div");
    host.append(renderMarkdown(md));
    return host;
  };

  test("intestazioni scalate, paragrafi, liste e codice", () => {
    const host = render("# Titolo\n\ntesto **forte** e `code`\n\n- uno\n- due\n\n```js\nconst a = 1;\n```\n");
    assert.strictEqual(host.querySelector("h3").textContent, "Titolo");
    assert.ok(host.querySelector("strong"));
    assert.strictEqual(host.querySelector("code").textContent, "code");
    assert.strictEqual(host.querySelectorAll("li").length, 2);
    const pre = host.querySelector("pre");
    assert.ok(pre);
    assert.strictEqual(pre.querySelector("code").textContent, "const a = 1;");
    assert.strictEqual(pre.querySelector("code").getAttribute("data-lang"), "js");
  });

  test("liste annidate e checkbox di task", () => {
    const host = render("- primo\n  - figlio\n- [x] fatto\n- [ ] da fare\n");
    const outer = host.querySelector("ul");
    assert.ok(outer);
    assert.ok(outer.querySelector("li ul"));
    const boxes = host.querySelectorAll(".os-check");
    assert.strictEqual(boxes.length, 2);
    assert.strictEqual(boxes[0].textContent, "\u2611");
    assert.strictEqual(boxes[1].textContent, "\u2610");
  });

  test("link solo http/https, il resto resta testo", () => {
    const host = render("[ok](https://example.com) [male](javascript:alert(1)) <b>html</b>");
    const links = host.querySelectorAll("a");
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].getAttribute("href"), "https://example.com");
    assert.strictEqual(links[0].getAttribute("rel"), "noopener noreferrer");
    // niente markup iniettato: il tag resta testo
    assert.strictEqual(host.querySelector("b"), null);
    assert.ok(host.textContent.includes("<b>html</b>"));
  });

  test("tabella, citazione e riga orizzontale", () => {
    const host = render("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> nota\n\n---\n");
    assert.strictEqual(host.querySelectorAll("table th").length, 2);
    assert.strictEqual(host.querySelectorAll("table td").length, 2);
    assert.strictEqual(host.querySelector("blockquote").textContent.trim(), "nota");
    assert.ok(host.querySelector("hr"));
  });

  test("input non-stringa o vuoto -> frammento vuoto", () => {
    assert.strictEqual(render("").children.length, 0);
    assert.strictEqual(render(null).children.length, 0);
  });
});

describe("dettaglio di una change", () => {
  test("artefatti presenti e specs multiple enumerate", async () => {
    const fs = createMockFs({
      tree: {
        openspec: { type: "directory" },
        "openspec/changes": { type: "directory" },
        "openspec/changes/x": { type: "directory" },
        "openspec/changes/x/proposal.md": { type: "file", size: 10 },
        "openspec/changes/x/design.md": { type: "file", size: 10 },
        "openspec/changes/x/specs": { type: "directory" },
        "openspec/changes/x/specs/alpha": { type: "directory" },
        "openspec/changes/x/specs/alpha/spec.md": { type: "file", size: 10 },
        "openspec/changes/x/specs/beta": { type: "directory" },
        "openspec/changes/x/specs/beta/spec.md": { type: "file", size: 10 },
        "openspec/changes/x/specs/beta/extra.md": { type: "file", size: 10 },
      },
      contents: { "openspec/changes/x/proposal.md": "# P\n", "openspec/changes/x/design.md": "# D\n" },
    });
    const detail = await loadChangeDetail(createContext(fs, "det-1"), "x");
    assert.strictEqual(detail.state, "ready");
    assert.strictEqual(detail.artifacts.proposal, "present");
    assert.strictEqual(detail.artifacts.tasks, "absent");
    assert.strictEqual(detail.specs.state, "present");
    assert.deepStrictEqual(detail.specs.files.map(f => `${f.capability}/${f.name}`), ["alpha/spec.md", "beta/extra.md", "beta/spec.md"]);
  });

  test("change illeggibile -> state error", async () => {
    const fs = createMockFs({
      tree: { openspec: { type: "directory" }, "openspec/changes": { type: "directory" } },
      rejectPaths: ["openspec/changes/x"],
      contents: {},
    });
    const fs2 = createMockFs({
      tree: { openspec: { type: "directory" }, "openspec/changes": { type: "directory" }, "openspec/changes/x": { type: "directory" } },
      rejectPaths: ["openspec/changes/x"],
    });
    const detail = await loadChangeDetail(createContext(fs2, "det-2"), "x");
    assert.strictEqual(detail.state, "error");
    assert.ok(detail.error.includes("openspec/changes/x"));
  });

  test("loadDoc: ok, binario, troncato, errore", async () => {
    const fs = createMockFs({
      tree: { "a.md": { type: "file" }, "b.bin": { type: "file" }, "c.md": { type: "file" } },
      contents: { "a.md": "# ciao\n", "c.md": "# lungo\n" },
      truncatedReads: ["c.md"],
    });
    const realRead = fs.readFile.bind(fs);
    fs.readFile = async (p) => {
      if (p === "b.bin") return { content: "", binary: true, truncated: false };
      if (p === "manca.md") throw new Error("ENOENT");
      return realRead(p);
    };
    const ctx = createContext(fs, "doc-1");
    assert.strictEqual((await loadDoc(ctx, "a.md")).state, "ok");
    assert.strictEqual((await loadDoc(ctx, "a.md")).content, "# ciao\n");
    assert.strictEqual((await loadDoc(ctx, "b.bin")).state, "binary");
    assert.strictEqual((await loadDoc(ctx, "c.md")).state, "truncated");
    assert.strictEqual((await loadDoc(ctx, "manca.md")).state, "error");
  });
});

describe("pannello: selezione, tab, task, refresh", () => {
  async function renderDetailFixture(id = "ui-1") {
    const fs = await createFsFromDir(fix("os-partial"));
    const { el, ctx } = await renderWith(fs, id);
    return { el, ctx, fs };
  }

  const tabPanel = (el) => el.shadowRoot.querySelector("#openspec-tabpanel");
  // I fixture su disco leggono con fs/promises: servono turni reali di event loop.
  const wait = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 5)); };

  test("la selezione apre il dettaglio con le quattro schede", async () => {
    const { el } = await renderDetailFixture("ui-sel");
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-detail"), null);
    const toggle = el.shadowRoot.querySelector(".os-change-toggle");
    assert.ok(toggle, "il change deve avere un controllo selezionabile");
    assert.strictEqual(toggle.getAttribute("aria-expanded"), "false");
    toggle.fire("click");
    await wait();
    const tabs = el.shadowRoot.querySelectorAll(".os-tab");
    assert.deepStrictEqual(tabs.map(t => t.getAttribute("aria-selected")), ["true", "false", "false", "false"]);
    for (const label of ["Proposal", "Design", "Specs", "Tasks"]) {
      assert.ok(tabs.some(t => t.textContent.trim().startsWith(label)), `scheda ${label}`);
    }
    assert.strictEqual(el.shadowRoot.querySelector(".os-change-toggle").getAttribute("aria-expanded"), "true");
  });

  test("proposal renderizzato in markdown; tasks raggruppati e non modificabili", async () => {
    const { el } = await renderDetailFixture("ui-doc");
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait();
    const panel = tabPanel(el);
    assert.ok(panel, "tabpanel presente");
    assert.ok(panel.querySelector("article.os-doc"), "proposal renderizzato");
    // tab Tasks
    el.shadowRoot.querySelector("#openspec-tab-tasks").fire("click");
    await wait();
    const tasksPanel = tabPanel(el);
    assert.ok(tasksPanel.textContent.includes("7 / 14"), tasksPanel.textContent.slice(0, 120));
    assert.ok(tasksPanel.querySelectorAll(".os-task-group").length >= 4);
    assert.ok(tasksPanel.querySelectorAll(".os-task").length >= 14);
    // nessun controllo editabile
    assert.strictEqual(tasksPanel.querySelectorAll("input, textarea, [contenteditable]").length, 0);
  });

  test("documento assente -> messaggio, nessuna lettura", async () => {
    const fs = createMockFs({
      tree: {
        openspec: { type: "directory" },
        "openspec/changes": { type: "directory" },
        "openspec/changes/solo-tasks": { type: "directory" },
        "openspec/changes/solo-tasks/tasks.md": { type: "file", size: 10 },
      },
      contents: { "openspec/changes/solo-tasks/tasks.md": "## A\n- [ ] x\n" },
    });
    const { el } = await renderWith(fs, "ui-absent");
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait();
    const panel = tabPanel(el);
    assert.ok(panel.textContent.includes("No proposal.md in this change."), panel.textContent.slice(0, 120));
    const before = fs.calls.read;
    el.shadowRoot.querySelector("#openspec-tab-design").fire("click");
    await wait(3);
    assert.strictEqual(fs.calls.read, before, "un documento assente non si legge");
    assert.ok(tabPanel(el).textContent.includes("No design.md in this change."));
  });

  test("piu' spec: navigazione tra i file", async () => {
    const fs = createMockFs({
      tree: {
        openspec: { type: "directory" },
        "openspec/changes": { type: "directory" },
        "openspec/changes/x": { type: "directory" },
        "openspec/changes/x/specs": { type: "directory" },
        "openspec/changes/x/specs/alpha": { type: "directory" },
        "openspec/changes/x/specs/alpha/spec.md": { type: "file", size: 5 },
        "openspec/changes/x/specs/beta": { type: "directory" },
        "openspec/changes/x/specs/beta/spec.md": { type: "file", size: 5 },
      },
      contents: { "openspec/changes/x/specs/alpha/spec.md": "# ALFA\n", "openspec/changes/x/specs/beta/spec.md": "# BETA\n" },
    });
    const { el } = await renderWith(fs, "ui-specs");
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait();
    el.shadowRoot.querySelector("#openspec-tab-specs").fire("click");
    await wait();
    const nav = el.shadowRoot.querySelectorAll(".os-spec");
    assert.strictEqual(nav.length, 2);
    assert.ok(tabPanel(el).textContent.includes("ALFA"));
    nav[1].fire("click");
    await wait();
    assert.ok(tabPanel(el).textContent.includes("BETA"), tabPanel(el).textContent.slice(0, 80));
  });

  test("errore di lettura documentato nella scheda", async () => {
    const fs = createMockFs({
      tree: {
        openspec: { type: "directory" },
        "openspec/changes": { type: "directory" },
        "openspec/changes/x": { type: "directory" },
        "openspec/changes/x/proposal.md": { type: "file", size: 5 },
      },
      rejectPaths: ["openspec/changes/x/proposal.md"],
    });
    const { el } = await renderWith(fs, "ui-err");
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait();
    const panel = tabPanel(el);
    assert.ok(/Cannot read/.test(panel.textContent), panel.textContent.slice(0, 120));
  });

  test("refresh manuale: scarta la cache, mostra loading, rilegge", async () => {
    const { el, fs } = await renderDetailFixture("ui-refresh");
    let reads = 0;
    const realRead = fs.readFile.bind(fs);
    fs.readFile = async (p) => { reads++; return realRead(p); };
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait();
    const reads0 = reads;
    const button = el.shadowRoot.querySelector("#openspec-refresh");
    assert.ok(button, "pulsante di refresh presente");
    button.fire("click");
    assert.strictEqual(button.getAttribute("aria-busy"), "true");
    await wait();
    assert.strictEqual(button.getAttribute("aria-busy"), "false");
    assert.ok(reads > reads0, "il refresh deve rileggere");
    assert.ok(el.shadowRoot.querySelector("#openspec-tabpanel article.os-doc"), "il documento resta visibile dopo il refresh");
  });

  test("timestamp nell'intestazione", async () => {
    const { el } = await renderDetailFixture("ui-stamp");
    const stamp = el.shadowRoot.querySelector("#openspec-stamp");
    assert.ok(stamp, "stamp presente");
    assert.ok(el.shadowRoot.querySelector("header .stamp"), "lo stamp sta nell'intestazione");
    assert.notStrictEqual(stamp.textContent.trim(), "");
  });

  test("cambio workspace durante il dettaglio: nessun dato del workspace precedente", async () => {
    const fsA = createMockFs({
      tree: {
        openspec: { type: "directory" },
        "openspec/changes": { type: "directory" },
        "openspec/changes/a": { type: "directory" },
        "openspec/changes/a/proposal.md": { type: "file", size: 5 },
      },
      contents: { "openspec/changes/a/proposal.md": "# WORKSPACE A\n" },
    });
    const { el } = await renderWith(fsA, "ui-switch-a");
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await settle();
    const fsB = createMockFs({ tree: { openspec: { type: "directory" }, "openspec/changes": { type: "directory" } } });
    el.context = createContext(fsB, "ui-switch-b");
    await wait();
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-detail"), null);
    assert.ok(el.shadowRoot.querySelector("#openspec-body").textContent.includes("No active changes."));
  });
});


// ──────────────────────────────────────────────────────────────────────
// Audit tecnico: race condition, sicurezza del markdown, Open in Files
// ──────────────────────────────────────────────────────────────────────
describe("audit: race condition", () => {
  const wait = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 5)); };

  test("stesso nome di change in due workspace: nessun contenuto del precedente", async () => {
    const mk = (wsId, content) => {
      const fs = createMockFs({
        tree: {
          openspec: { type: "directory" },
          "openspec/changes": { type: "directory" },
          "openspec/changes/same-name": { type: "directory" },
          "openspec/changes/same-name/proposal.md": { type: "file", size: 5 },
        },
        contents: { "openspec/changes/same-name/proposal.md": content },
      });
      return { fs, ctx: createContext(fs, wsId) };
    };
    const a = mk("shared-a", "# CONTENUTO DEL WORKSPACE A\n");
    const b = mk("shared-b", "# CONTENUTO DEL WORKSPACE B\n");
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    el.context = a.ctx;
    await wait();
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait();
    assert.ok(el.shadowRoot.querySelector(".os-doc").textContent.includes("WORKSPACE A"));

    el.context = b.ctx; // cambio workspace, stessa change "same-name"
    await wait();
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-detail"), null, "la selezione non sopravvive al cambio workspace");
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait();
    const text = el.shadowRoot.querySelector(".os-doc").textContent;
    assert.ok(text.includes("WORKSPACE B"), text.slice(0, 80));
    assert.ok(!text.includes("WORKSPACE A"), "nessun residuo del workspace precedente");
  });

  test("un dettaglio lento e superato non sovrascrive quello fresco", async () => {
    // Elenco iniziale: la change non ha specs. Il primo load di dettaglio resta
    // appeso e, quando infine risponde, porta la fotografia vecchia (senza specs).
    // Nel frattempo un refresh legge la nuova (con specs): la vecchia non deve
    // tornare a schermo quando arriva.
    const fs = createMockFs({
      tree: {
        openspec: { type: "directory" },
        "openspec/changes": { type: "directory" },
        "openspec/changes/x": { type: "directory" },
        "openspec/changes/x/proposal.md": { type: "file", size: 5 },
      },
      contents: { "openspec/changes/x/proposal.md": "# doc\n" },
    });
    let dirCalls = 0;
    const pending = [];
    const entriesOf = (names) => names.map(n => ({ name: n, type: n.includes(".") ? "file" : "directory", size: 5, modifiedAt: null }));
    const lists = {
      openspec: ["changes"],
      "openspec/changes": ["x"],
      "openspec/changes/x/specs": ["alpha"],
      "openspec/changes/x/specs/alpha": ["spec.md"],
    };
    fs.listFiles = async (path) => {
      const p = path.replace(/\/$/, "");
      if (p === "openspec/changes/x") {
        dirCalls++;
        // La fotografia va presa PRIMA del blocco: il load "vecchio" deve
        // portare davvero il contenuto vecchio (senza specs).
        const names = dirCalls >= 3 ? ["proposal.md", "specs"] : ["proposal.md"];
        if (dirCalls === 2) await new Promise(resolve => pending.push(resolve));
        return { entries: entriesOf(names), scannedAt: new Date().toISOString(), truncated: false };
      }
      const names = lists[p];
      if (names === undefined) throw new Error(`Path does not exist: ${path}`);
      return { entries: entriesOf(names), scannedAt: new Date().toISOString(), truncated: false };
    };

    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    el.context = createContext(fs, "race-1");
    await wait();
    el.shadowRoot.querySelector(".os-change-toggle").fire("click"); // dettaglio "vecchio": appeso
    await wait(2);
    el.shadowRoot.querySelector("#openspec-refresh").fire("click"); // rilettura fresca
    await wait(10);
    const specsTab = () => el.shadowRoot.querySelectorAll(".os-tab")[2].textContent.replace(/\s+/g, "");
    assert.ok(/Specs\d/.test(specsTab()), `dopo il refresh la scheda Specs deve avere un conteggio: ${specsTab()}`);
    // ora arriva la risposta vecchia: non deve tornare "assente"
    for (const resolve of pending.splice(0)) resolve();
    await wait(10);
    assert.ok(/Specs\d/.test(specsTab()), `dopo la risposta vecchia: ${specsTab()}`);
  });
});

describe("audit: sicurezza del markdown", () => {
  const render = (md) => {
    const host = globalThis.document.createElement("div");
    host.append(renderMarkdown(md));
    return host;
  };

  test("HTML nel documento resta testo, anche con attributi", () => {
    const host = render('<img src=x onerror="alert(1)">\n\n<scr' + 'ipt>alert(1)</scr' + 'ipt>\n');
    assert.strictEqual(host.querySelector("img"), null);
    assert.strictEqual(host.querySelector("script"), null);
    assert.ok(host.textContent.includes("onerror"));
    assert.strictEqual(host.querySelectorAll("a").length, 0);
  });

  test("URL non http(s) non diventano link", () => {
    const host = render("[a](javascript:alert(1)) [b](data:text/html,x) [c](//evil.example) [d](file:///etc/passwd)");
    assert.strictEqual(host.querySelectorAll("a").length, 0);
    assert.ok(host.textContent.includes("javascript:alert(1)"));
  });

  test("le virgolette nell'URL non creano attributi", () => {
    const host = render('[x](https://example.com/"onmouseover="alert(1))');
    const a = host.querySelector("a");
    assert.ok(a);
    assert.strictEqual(a.getAttribute("onmouseover"), null);
    // l'URL si ferma alla parentesi di chiusura: nessun attributo in piu'
    assert.strictEqual(a.getAttribute("href"), 'https://example.com/"onmouseover="alert(1');
    assert.strictEqual(a.getAttribute("rel"), "noopener noreferrer");
    assert.strictEqual(a.getAttribute("target"), "_blank");
  });

  test("immagine markdown non produce tag ne' link pericolosi", () => {
    const host = render("![alt](javascript:alert(1)) ![ok](https://example.com/i.png)");
    assert.strictEqual(host.querySelector("img"), null);
    assert.strictEqual(host.querySelectorAll("a").length, 0, "nessun link da sintassi immagine");
    assert.ok(host.textContent.includes("![ok](https://example.com/i.png)"), "la sintassi immagine resta testo");
  });
});

describe("audit: Open in Files", () => {
  const wait = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 5)); };
  const fixture = (id) => {
    const fs = createMockFs({
      tree: {
        openspec: { type: "directory" },
        "openspec/changes": { type: "directory" },
        "openspec/changes/x": { type: "directory" },
        "openspec/changes/x/proposal.md": { type: "file", size: 5 },
      },
      contents: { "openspec/changes/x/proposal.md": "# doc\n" },
    });
    return createContext(fs, id);
  };

  test("senza navigate il pulsante non compare (solo percorso)", async () => {
    const ctx = fixture("open-1");
    const noNav = { machine: ctx.machine, workspace: ctx.workspace, files: ctx.files };
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    el.context = noNav;
    await wait();
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait();
    assert.ok(el.shadowRoot.querySelector(".os-doc-path"), "il percorso resta visibile");
    assert.strictEqual(el.shadowRoot.querySelector(".os-open-file"), null, "niente pulsante senza navigate");
  });

  test("con navigate il pulsante apre il file nel pannello Files", async () => {
    const ctx = fixture("open-2");
    const calls = [];
    const withNav = { ...ctx, navigate: (dest, opts) => { calls.push({ dest, opts }); return Promise.resolve(); } };
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    el.context = withNav;
    await wait();
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait();
    const button = el.shadowRoot.querySelector(".os-open-file");
    assert.ok(button, "pulsante presente con navigate");
    button.fire("click");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].dest.tool, "files:workspace.files");
    assert.deepStrictEqual(calls[0].dest.query, { file: "openspec/changes/x/proposal.md" });
    assert.deepStrictEqual(calls[0].opts, { mode: "patch" });
  });

  test("navigate che rifiuta non produce unhandled rejection", async () => {
    const ctx = fixture("open-3");
    const withNav = { ...ctx, navigate: () => Promise.reject(new Error("route failed")) };
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    el.context = withNav;
    await wait();
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait();
    el.shadowRoot.querySelector(".os-open-file").fire("click");
    await wait(); // se il rifiuto non fosse gestito, node:test farebbe fallire la suite
    assert.ok(true);
  });
});


// ──────────────────────────────────────────────────────────────────────
// Migliorie: auto-refresh, persistenza, validità OpenSpec
// ──────────────────────────────────────────────────────────────────────
const wait = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 5)); };

// Workspace mutabile: permette di simulare una modifica esterna (il mtime
// avanza a ogni scrittura, come farebbe un editor).
function mutableWorkspace(tasksText) {
  const state = {
    tasks: tasksText,
    proposal: "# Perche\n\n" + "x".repeat(60) + "\n\n## What Changes\n\n- qualcosa\n",
    extra: false,
    mtime: 1,
  };
  const entries = (names) => names.map(n => ({ name: n, type: n.includes(".") ? "file" : "directory", size: 10, modifiedAt: `2026-11-07T10:00:${String(state.mtime).padStart(2, "0")}Z` }));
  const files = {
    async listFiles(path) {
      const p = path.replace(/\/$/, "");
      if (p === "openspec") return { entries: entries(["changes"]), scannedAt: "", truncated: false };
      if (p === "openspec/changes") return { entries: entries(["x"]), scannedAt: "", truncated: false };
      if (p === "openspec/changes/x") return { entries: entries(state.extra ? ["proposal.md", "tasks.md", "design.md"] : ["proposal.md", "tasks.md"]), scannedAt: "", truncated: false };
      throw new Error("Path does not exist: " + path);
    },
    async readFile(path) {
      if (path.endsWith("tasks.md")) return { content: state.tasks, truncated: false };
      if (path.endsWith("proposal.md")) return { content: state.proposal, truncated: false };
      if (path.endsWith("design.md")) return { content: "# Design\n", truncated: false };
      throw new Error("Path does not exist: " + path);
    },
  };
  return { state, files, ctx: createContext(files, "improve-1") };
}

const navStub = (initial = {}) => {
  const query = { ...initial };
  return {
    version: 1,
    contributionId: "openspec-status:openspec-status",
    query,
    set(key, value, options) {
      if (value === undefined || value === null) delete query[key];
      else query[key] = String(value);
      this.last = { key, value, options };
    },
  };
};

describe("migliorie: auto-refresh esterno", () => {
  test("modifica esterna di tasks.md aggiornata dal controllo, senza Refresh", async () => {
    const ws = mutableWorkspace("## A\n- [x] a\n- [ ] b\n");
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    el.context = ws.ctx;
    await wait(8);
    el.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait(8);
    el.shadowRoot.querySelector("#openspec-tab-tasks").fire("click");
    await wait(8);
    const before = el.shadowRoot.querySelector(".tasks").textContent;
    assert.strictEqual(before, "1 / 2 (50%)");

    ws.state.tasks = "## A\n- [x] a\n- [x] b\n"; // modifica esterna
    ws.state.mtime = 2;
    await el._checkExternalChanges();
    await wait(10);
    assert.strictEqual(el.shadowRoot.querySelector(".tasks").textContent, "2 / 2 (100%)");
    // Anche il contenuto aperto (non solo la card) deve essere quello nuovo:
    // qui stava il difetto osservato nel browser dopo l'auto-refresh.
    assert.strictEqual(el.shadowRoot.querySelector(".os-task-summary").textContent.replace(/\s+/g, " ").trim(), "2 / 2 tasks done (0 left, 100%)");
    assert.strictEqual([...el.shadowRoot.querySelectorAll(".os-task--done")].length, 2);
    el.disconnectedCallback();
  });

  test("nessuna modifica -> nessuna rilettura e nessun render", async () => {
    const ws = mutableWorkspace("## A\n- [x] a\n- [ ] b\n");
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    el.context = ws.ctx;
    await wait(8);
    await el._checkExternalChanges(); // impronta iniziale
    const stamp = el.shadowRoot.querySelector("#openspec-stamp").textContent;
    const stateRef = el.state;
    await el._checkExternalChanges();
    await el._checkExternalChanges();
    await wait(6);
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-stamp").textContent, stamp);
    assert.strictEqual(el.state, stateRef, "nessun nuovo stato senza modifiche");
    el.disconnectedCallback();
  });

  test("timer attivo solo da montato: rimosso alla disattivazione", async () => {
    const ws = mutableWorkspace("## A\n- [ ] b\n");
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    assert.strictEqual(el.hasTimer, true);
    el.context = ws.ctx;
    await wait(4);
    el.disconnectedCallback();
    assert.strictEqual(el.hasTimer, false);
  });

  test("controllo e refresh manuale concorrenti: nessuna risposta superata", async () => {
    const ws = mutableWorkspace("## A\n- [x] a\n- [ ] b\n");
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    el.context = ws.ctx;
    await wait(8);
    ws.state.tasks = "## A\n- [x] a\n- [x] b\n";
    ws.state.mtime = 3;
    // tick e refresh manuale insieme
    const tick = el._checkExternalChanges();
    el.shadowRoot.querySelector("#openspec-refresh").fire("click");
    await tick;
    await wait(12);
    assert.strictEqual(el.shadowRoot.querySelector(".tasks").textContent, "2 / 2 (100%)");
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-refresh").getAttribute("aria-busy"), "false");
    el.disconnectedCallback();
  });
});

describe("migliorie: persistenza della selezione", () => {
  test("selezione, scheda e file di spec sopravvivono al rimontaggio", async () => {
    const fs = createMockFs({
      tree: {
        openspec: { type: "directory" },
        "openspec/changes": { type: "directory" },
        "openspec/changes/x": { type: "directory" },
        "openspec/changes/x/proposal.md": { type: "file", size: 5 },
        "openspec/changes/x/specs": { type: "directory" },
        "openspec/changes/x/specs/alpha": { type: "directory" },
        "openspec/changes/x/specs/alpha/spec.md": { type: "file", size: 5 },
        "openspec/changes/x/specs/beta": { type: "directory" },
        "openspec/changes/x/specs/beta/spec.md": { type: "file", size: 5 },
      },
      contents: {
        "openspec/changes/x/proposal.md": "# P\n",
        "openspec/changes/x/specs/alpha/spec.md": "# ALPHA\n",
        "openspec/changes/x/specs/beta/spec.md": "# BETA\n",
      },
    });
    const nav = navStub();
    const ctx = { ...createContext(fs, "persist-1"), navigation: nav };
    const first = new OpenspecPanelElement();
    first.isConnected = true;
    first.connectedCallback();
    first.context = ctx;
    await wait(8);
    first.shadowRoot.querySelector(".os-change-toggle").fire("click");
    await wait(8);
    first.shadowRoot.querySelector("#openspec-tab-specs").fire("click");
    await wait(8);
    first.shadowRoot.querySelectorAll(".os-spec")[1].fire("click");
    await wait(8);
    assert.strictEqual(nav.query.osChange, "x");
    assert.strictEqual(nav.query.osTab, "specs");
    assert.strictEqual(nav.query.osSpec, "1");
    first.disconnectedCallback();

    // "ritorno" dal pannello Files: nuovo elemento, stesso stato di navigazione
    const second = new OpenspecPanelElement();
    second.isConnected = true;
    second.connectedCallback();
    second.context = { ...createContext(fs, "persist-1"), navigation: nav };
    await wait(12);
    const selected = [...second.shadowRoot.querySelectorAll(".os-change-toggle")].find(t => t.getAttribute("aria-expanded") === "true");
    assert.ok(selected, "change riselezionata");
    const tab = [...second.shadowRoot.querySelectorAll(".os-tab")].find(t => t.getAttribute("aria-selected") === "true");
    assert.strictEqual(tab.textContent.replace(/\s+/g, " ").trim().startsWith("Specs"), true);
    const doc = second.shadowRoot.querySelector(".os-doc");
    assert.ok(doc && doc.textContent.includes("BETA"), doc ? doc.textContent.slice(0, 40) : "nessun documento");
    second.disconnectedCallback();
  });

  test("change sparita: si riparte dall'elenco senza inventare stato", async () => {
    const fs = createMockFs({
      tree: { openspec: { type: "directory" }, "openspec/changes": { type: "directory" }, "openspec/changes/y": { type: "directory" }, "openspec/changes/y/proposal.md": { type: "file", size: 5 } },
      contents: { "openspec/changes/y/proposal.md": "# Y\n" },
    });
    const nav = navStub({ osChange: "sparita", osTab: "tasks" });
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    el.context = { ...createContext(fs, "persist-2"), navigation: nav };
    await wait(10);
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-detail"), null);
    assert.strictEqual(nav.query.osChange, undefined, "la chiave stantia viene ripulita");
    el.disconnectedCallback();
  });

  test("cambio workspace: nessuna contaminazione fra progetti", async () => {
    const mk = (wsId, change) => createMockFs({
      tree: { openspec: { type: "directory" }, "openspec/changes": { type: "directory" }, [`openspec/changes/${change}`]: { type: "directory" }, [`openspec/changes/${change}/proposal.md`]: { type: "file", size: 5 } },
      contents: { [`openspec/changes/${change}/proposal.md`]: `# ${change}\n` },
    });
    const navA = navStub({ osChange: "a-change", osTab: "tasks" });
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    el.context = { ...createContext(mk("ws-a", "a-change"), "proj-a"), navigation: navA };
    await wait(10);
    assert.ok(el.shadowRoot.querySelector("#openspec-detail"), "A: dettaglio ripristinato");

    const navB = navStub({ osChange: "a-change" }); // stesso nome, progetto diverso
    el.context = { ...createContext(mk("ws-b", "b-only"), "proj-b"), navigation: navB };
    await wait(10);
    assert.strictEqual(el.shadowRoot.querySelector("#openspec-detail"), null, "B: nessun dettaglio ereditato");
    const cards = [...el.shadowRoot.querySelectorAll(".os-change-toggle")];
    assert.strictEqual(cards.length, 1);
    assert.ok(cards[0].textContent.includes("b-only"));
    assert.strictEqual(cards[0].getAttribute("aria-expanded"), "false");
    el.disconnectedCallback();
  });
});

describe("migliorie: validità OpenSpec", () => {
  test("proposal assente -> incomplete (artefatto non creato)", () => {
    const result = inspectChangeValidity({ proposalText: null, hasProposal: false, specFiles: [], hasSpecs: false });
    assert.strictEqual(result.state, "incomplete");
    assert.ok(result.reasons.some(r => r.includes("proposal.md missing")));
  });

  const specOk = "# cap Specification\n\n## ADDED Requirements\n\n### Requirement: Cose\nIl sistema SHALL fare cose.\n\n#### Scenario: Caso\n- **WHEN** x\n- **THEN** y\n";
  const proposalOk = "# T\n\n## Why\n\n" + "y".repeat(60) + "\n\n## What Changes\n\n- una cosa\n";

  test("change valida (stessa forma della fixture BikeCare)", () => {
    const result = inspectChangeValidity({ proposalText: proposalOk, hasProposal: true, specFiles: [{ path: "a/spec.md", content: specOk }], hasSpecs: true });
    assert.strictEqual(result.state, "valid");
    assert.strictEqual(result.checked, true);
  });

  test("senza deltas -> incomplete, non invalida", () => {
    const result = inspectChangeValidity({ proposalText: proposalOk, hasProposal: true, specFiles: [], hasSpecs: false });
    assert.strictEqual(result.state, "incomplete");
    assert.ok(result.reasons.some(r => r.includes("no deltas")));
  });

  test("requisito senza SHALL/MUST o senza scenario -> invalid", () => {
    const noShall = inspectChangeValidity({ proposalText: proposalOk, specFiles: [{ path: "a/spec.md", content: "## ADDED Requirements\n\n### Requirement: X\nUna frase senza verbo.\n\n#### Scenario: S\n- **WHEN** a\n" }], hasSpecs: true });
    assert.strictEqual(noShall.state, "invalid");
    assert.ok(noShall.reasons.some(r => r.includes("no SHALL/MUST")));
    const noScenario = inspectChangeValidity({ proposalText: proposalOk, specFiles: [{ path: "a/spec.md", content: "## ADDED Requirements\n\n### Requirement: X\nIl sistema SHALL fare.\n" }], hasSpecs: true });
    assert.strictEqual(noScenario.state, "invalid");
    assert.ok(noScenario.reasons.some(r => r.includes("Scenario")));
    const noDelta = inspectChangeValidity({ proposalText: proposalOk, specFiles: [{ path: "a/spec.md", content: "# cap\n\n## Requirements\n\n### Requirement: X\nIl sistema SHALL fare.\n\n#### Scenario: S\n- **WHEN** a\n" }], hasSpecs: true });
    assert.strictEqual(noDelta.state, "invalid");
    assert.ok(noDelta.reasons.some(r => r.includes("no delta header")));
  });

  test("Why troppo corta -> invalid (artefatto presente ma non conforme)", () => {
    const result = inspectChangeValidity({ proposalText: "# T\n\n## Why\n\ntroppo breve\n\n## What Changes\n\n- x\n", hasProposal: true, specFiles: [{ path: "a/spec.md", content: specOk }], hasSpecs: true });
    assert.strictEqual(result.state, "invalid");
    assert.ok(result.reasons.some(r => r.includes("Why section")));
  });

  test("skip_specs dichiarato -> valida senza deltas", () => {
    const result = inspectChangeValidity({ proposalText: proposalOk, hasProposal: true, specFiles: [], hasSpecs: false, skipSpecs: true });
    assert.strictEqual(result.state, "valid");
  });

  test("senza proposal leggibile -> unverified (nessun giudizio inventato)", () => {
    const result = inspectChangeValidity({ proposalText: null, hasProposal: true, specFiles: [], hasSpecs: true });
    assert.strictEqual(result.state, "unverified");
    assert.strictEqual(result.checked, false);
  });
});


describe("review: lifecycle, markdown and partial-file regressions", () => {
  const baseTree = { openspec: { type: "directory" }, "openspec/changes": { type: "directory" } };
  const proposal = "# Title\n\n## Why\n\n" + "x".repeat(60) + "\n\n## What Changes\n- feature\n";
  const spec = "## ADDED Requirements\n### Requirement: R\nThe system SHALL work.\n#### Scenario: S\n- WHEN ready\n- THEN works\n";

  test("malformed fenced-code lines do not hang the Markdown parser", () => {
    for (const input of ["\x60\x60\x60js\x60oops", "~~~js\x60oops"]) {
      const fragment = renderMarkdown(input + "\nNext line");
      assert.strictEqual(fragment.children.length, 1);
      assert.strictEqual(fragment.children[0].tag, "p");
    }
  });

  test("changing workspace releases a pending manual refresh", async () => {
    const fsA = createMockFs({ tree: baseTree });
    const fsB = createMockFs({ tree: baseTree });
    const original = fsA.listFiles.bind(fsA);
    let delay = false, release;
    fsA.listFiles = async (path) => {
      if (delay && path === "openspec") await new Promise(resolve => { release = resolve; });
      return original(path);
    };
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    try {
      el.context = createContext(fsA, "review-switch-a");
      await wait(8);
      delay = true;
      const refresh = el.shadowRoot.querySelector("#openspec-refresh");
      refresh.fire("click");
      assert.strictEqual(refresh.getAttribute("aria-busy"), "true");
      await Promise.resolve();
      assert.strictEqual(typeof release, "function");
      el.context = createContext(fsB, "review-switch-b");
      await wait(8);
      release();
      await wait(8);
      assert.strictEqual(refresh.getAttribute("aria-busy"), "false");
      const before = fsB.calls.list;
      refresh.fire("click");
      await wait(8);
      assert.ok(fsB.calls.list > before);
    } finally {
      if (release) release();
      el.disconnectedCallback();
    }
  });


  test("replacing the context object for the same workspace unblocks refresh", async () => {
    const files = createMockFs({ tree: baseTree });
    const original = files.listFiles.bind(files);
    let stall = false, release;
    files.listFiles = async (path) => {
      if (stall && path === "openspec") await new Promise(resolve => { release = resolve; });
      return original(path);
    };
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    try {
      const ctx = createContext(files, "review-same-context");
      el.context = ctx;
      await wait(8);
      stall = true;
      const btn = el.shadowRoot.querySelector("#openspec-refresh");
      btn.fire("click");
      await Promise.resolve();
      assert.strictEqual(typeof release, "function");
      el.context = { ...ctx }; // PI WEB can recreate context for the same workspace
      await wait(8);
      stall = false;
      release();
      await wait(8);
      assert.strictEqual(btn.getAttribute("aria-busy"), "false");
      const before = files.calls.list;
      btn.fire("click");
      await wait(8);
      assert.ok(files.calls.list > before, "refresh must be usable after same-workspace context replacement");
    } finally {
      if (release) release();
      el.disconnectedCallback();
    }
  });

  async function expectUnverified(kind) {
    const tree = {
      ...baseTree,
      "openspec/changes/x": { type: "directory" },
      "openspec/changes/x/proposal.md": { type: "file" },
      "openspec/changes/x/specs": { type: "directory" },
      "openspec/changes/x/specs/alpha": { type: "directory" },
      "openspec/changes/x/specs/alpha/spec.md": { type: "file" },
      ...(kind === "unreadable" ? { "openspec/changes/x/specs/beta": { type: "directory" } } : {}),
    };
    const files = createMockFs({
      tree,
      contents: {
        "openspec/changes/x/proposal.md": proposal,
        "openspec/changes/x/specs/alpha/spec.md": spec,
      },
      rejectPaths: kind === "unreadable" ? ["openspec/changes/x/specs/beta"] : [],
      truncatedReads: kind === "truncated" ? ["openspec/changes/x/specs/alpha/spec.md"] : [],
    });
    const el = new OpenspecPanelElement();
    el.isConnected = true;
    el.connectedCallback();
    try {
      el.context = createContext(files, "review-validation-" + kind);
      await wait(8);
      el.shadowRoot.querySelector(".os-change-toggle").fire("click");
      await wait(12);
      const badge = el.shadowRoot.querySelector(".os-validity");
      assert.ok(badge);
      assert.strictEqual(badge.textContent, "?", "partial reads must not produce structure ok");
    } finally {
      el.disconnectedCallback();
    }
  }

  test("unreadable spec directory must not produce structure ok", async () => expectUnverified("unreadable"));
  test("truncated spec must not produce structure ok", async () => expectUnverified("truncated"));
});

console.log("OK: suite eseguita");
