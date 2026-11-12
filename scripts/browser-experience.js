// Execute this exported function in a real browser (e.g. via browser_execute/CDP).
// source must be the exact dist/pi-web-plugin.js text. No production files/API used.
export async function runBrowserExperience(source) {
  const errors = [], checks = [];
  const onError = event => errors.push(event.message || String(event.reason));
  addEventListener('error', onError); addEventListener('unhandledrejection', onError);
  const assert = (condition, name) => { if (!condition) throw Error(name); checks.push(name); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async test => { const limit = performance.now() + 6000; while (!test()) { if (performance.now() > limit) throw Error('Browser readiness timeout'); await wait(10); } };
  const tree = new Map([['openspec', 'directory'], ['openspec/changes', 'directory'], ['openspec/changes/archive', 'directory']]);
  const contents = new Map(); let calls = 0, archiveCalls = 0, delay = 0;
  for (const name of ['alpha', 'beta', 'gamma', 'delta', 'archive/arbitrary-name']) {
    const base = 'openspec/changes/' + name; tree.set(base, 'directory');
    for (const file of ['proposal.md', 'design.md', 'tasks.md', 'specs/one/spec.md', 'specs/two/spec.md']) {
      tree.set(base + '/' + file, 'file');
      contents.set(base + '/' + file, file === 'tasks.md' ? '## Work\n- [x] Done\n- [ ] Pending\n## Later\n- [ ] Follow up\n'
        : file === 'proposal.md' ? '## Why\n' + 'A meaningful operational explanation. '.repeat(3) + '\n## What Changes\n- support workflows\n'
        : file.endsWith('spec.md') ? '## ADDED Requirements\n### Requirement: R\nSystem MUST work.\n#### Scenario: Works\n- **WHEN** ready\n- **THEN** works\n' : '# Design\nUseful **design**.');
    }
    for (const dir of ['specs', 'specs/one', 'specs/two']) tree.set(base + '/' + dir, 'directory');
  }
  const files = {
    async listFiles(path, options) {
      calls++; if (path.includes('/archive')) archiveCalls++;
      if (delay) await wait(delay);
      if (options?.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      path = path.replace(/\/$/, ''); if (tree.get(path) !== 'directory') throw Error('Missing directory');
      return { entries: [...tree].filter(([key]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')).map(([key, type]) => ({ name: key.slice(path.length + 1), type, size: 10, modifiedAt: 1 })), truncated: false };
    },
    async readFile(path, options) {
      calls++; if (delay) await wait(delay); if (options?.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      if (!contents.has(path)) throw Error('Missing file'); return { content: contents.get(path), binary: false, truncated: false };
    },
  };
  let el;
  try {
    const plugin = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));
    const contribution = (await plugin.default.activate({ html: (strings, ...values) => ({ strings, values }), svg: strings => strings })).contributions.workspacePanels[0];
    assert(plugin.default.apiVersion === 5 && contribution.invalidationResources.includes('workspace.files'), 'API v5 contribution and lifecycle contract');
    const query = {};
    const ctx = { machine: { id: 'synthetic-browser' }, workspace: { id: 'browser-experience', projectId: 'synthetic' }, files, navigation: { query, set(key, value) { if (!/^[a-z][a-z0-9.-]*$/.test(key)) throw Error('invalid navigation key'); if (value == null) delete query[key]; else query[key] = value; } } };
    const container = document.createElement('div'); container.style.cssText = 'height:550px;overflow:auto;max-width:100%;padding:8px';
    document.body.replaceChildren(container);
    document.documentElement.style.cssText = '--pi-text:#202020;--pi-muted:#666;--pi-surface:#fff;--pi-border-muted:#ddd;--pi-accent:#5a38ad;--pi-purple-surface:#f5f0ff';
    el = document.createElement('openspec-status-panel'); container.append(el); el.context = ctx;
    const root = el.shadowRoot, q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
    await until(() => el.state?.changes.length === 4); await wait(50);
    assert(archiveCalls === 0, 'archive is not scanned during active load or probe');
    const before = calls; const search = q('#openspec-search'); search.focus(); search.value = 'AL'; search.setSelectionRange(1, 1); search.dispatchEvent(new Event('input'));
    assert(qa('.os-change-toggle').length === 1 && root.activeElement === search && search.selectionStart === 1, 'instant case-insensitive search retains focus and caret');
    assert(calls === before, 'typing makes zero filesystem requests');
    search.value = ''; search.dispatchEvent(new Event('input'));
    q('.os-change-toggle').focus(); q('.os-change-toggle').click();
    await until(() => q('.os-doc')); await wait(50);
    assert(root.activeElement?.dataset.focusKey === 'change:alpha', 'async detail/validity preserves change button focus');
    q('#openspec-tab-proposal').focus(); q('#openspec-tab-proposal').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await until(() => qa('.os-task').length === 3);
    assert(root.activeElement?.id === 'openspec-tab-tasks', 'keyboard End selects and focuses Tasks');
    q('.os-task-group').open = false; await wait(10);
    qa('.os-task-filters button')[1].click();
    assert(qa('.os-task').length === 2 && !q('.os-task-group').open, 'pending tasks remain grouped and collapsed state survives filter');
    q('#openspec-tab-tasks').focus(); container.scrollTop = 140; const top = container.scrollTop;
    q('#openspec-refresh').click();
    await until(() => !q('#openspec-refresh').disabled && qa('.os-task').length === 2); await wait(50);
    assert(!q('.os-task-group').open, 'collapsed task section survives refresh');
    assert(container.scrollTop === top, 'workspace container scroll survives refresh');
    assert(root.activeElement?.id === 'openspec-tab-tasks', 'tab focus survives intermediate refresh loading layouts');
    assert(query['os-tab'] === 'tasks' && query['os-tasks'] === 'pending', 'navigation keys persist selection and filter');
    q('#openspec-check').click(); await until(() => /4\/4/.test(q('.os-diagnostics').textContent));
    assert(/4 pass/.test(q('.os-diagnostics').textContent), 'explicit batch completes with local structural pass summary');
    q('#openspec-view').value = 'archive'; q('#openspec-view').dispatchEvent(new Event('change'));
    await until(() => el.state?.changes[0]?.name === 'arbitrary-name'); q('.os-change-toggle').click();
    await until(() => q('.os-doc-path')?.textContent.includes('archive/arbitrary-name'));
    assert(q('.os-doc') !== null, 'arbitrary archive names reuse document renderer');
    const archiveBefore = calls; await el._checkExternalChanges(); assert(calls === archiveBefore, 'ordinary polling does not scan archive');
    assert(document.documentElement.scrollWidth <= innerWidth, 'no horizontal overflow at current viewport');
    delay = 100; el._manualRefresh();
    el.context = { ...ctx, machine: { id: 'different-machine' }, workspace: { id: 'different-workspace' }, navigation: { ...ctx.navigation, query: {} } };
    assert(el.state === null && !q('#openspec-body').textContent.includes('arbitrary-name'), 'workspace switch immediately removes previous machine data');
    delay = 0; await until(() => el.state?.kind === 'ready');
    assert(errors.length === 0, 'no page errors or unhandled rejections');
    globalThis.__experienceElement = el;
    return { checks, errors, calls, viewport: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth };
  } finally {
    removeEventListener('error', onError); removeEventListener('unhandledrejection', onError);
    // Keep final panel for a screenshot; caller removes it afterwards.
  }
}
