import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDomStub } from './dom-stub.js';
import { createContext, createMockFs, settle } from './fs-mock.js';
const dom = createDomStub();
Object.assign(globalThis, dom);
const p = await import('../src/pi-web-plugin.js');
const { OpenspecPanelElement: Panel, selectChanges, workspaceSummary, loadOpenSpecState, loadDoc, setRequestTimeoutMs } = p;
let seq = 0;
const panels = [];
afterEach(() => { for (const el of panels.splice(0)) { el.isConnected = false; el.disconnectedCallback(); } setRequestTimeoutMs(15000); });
const dir = { type: 'directory' }, file = { type: 'file' };
const proposal = '## Why\n' + 'Useful behavior. '.repeat(6) + '\n## What Changes\n- behavior\n';
const spec = '## ADDED Requirements\n### Requirement: Work\nSystem MUST work.\n#### Scenario: Works\n- **WHEN** ready\n- **THEN** works\n';
function fixture({ count = 4, archive = 0, truncatedPaths = [], rejectPaths = [] } = {}) {
  const tree = { openspec: dir, 'openspec/changes': dir }, contents = {};
  const add = (name, i) => {
    const base = 'openspec/changes/' + name;
    tree[base] = dir; tree[base + '/proposal.md'] = file;
    contents[base + '/proposal.md'] = proposal;
    if (i % 4 !== 3) {
      tree[base + '/tasks.md'] = file;
      contents[base + '/tasks.md'] = `## Work\n- [${i % 4 ? 'x' : ' '}] first\n- [${i % 4 === 2 ? 'x' : ' '}] second\n## Empty\n`;
    }
    tree[base + '/specs'] = dir; tree[base + '/specs/cap'] = dir; tree[base + '/specs/cap/spec.md'] = file;
    contents[base + '/specs/cap/spec.md'] = spec;
  };
  for (let i = 0; i < count; i++) add('change-' + String(i).padStart(2, '0'), i);
  if (archive) { tree['openspec/changes/archive'] = dir; for (let i = 0; i < archive; i++) add('archive/any-name-' + i, i); }
  const fs = createMockFs({ tree, contents, truncatedPaths, rejectPaths });
  const raw = fs.listFiles.bind(fs);
  fs.listFiles = async (path, options) => { const res = await raw(path, options); return { ...res, entries: res.entries.map(e => ({ ...e, modifiedAt: 1 })) }; };
  return fs;
}
async function mount(files = fixture(), navigation) {
  const el = new Panel(); panels.push(el); el.isConnected = true; el.connectedCallback();
  const ctx = createContext(files, `experience-${++seq}`); if (navigation) ctx.navigation = navigation;
  el.context = ctx; await settle(12); return { el, ctx, files, root: el.shadowRoot };
}
const task = (name, completed, total, known = true) => ({ name, tasks: { completed, total, known }, artifacts: { proposal: 'present', tasks: 'present' } });
const changes = [task('Zulu', 2, 2), task('alpha', 0, 2), task('beta', 1, 2), task('unknown', 0, 0, false), task('zero', 0, 0)];
const names = list => list.map(ch => ch.name);
function nav(initial = {}) { return { query: { ...initial }, set(k, v) { assert.match(k, /^[a-z][a-z0-9.-]*$/); if (v == null) delete this.query[k]; else this.query[k] = String(v); } }; }

test('runtime pruning retains the newly mounted workspace above 32 owners', async () => {
  for (let i = 0; i < 32; i++) await mount(fixture({ count: 0 }));
  const { el, ctx, files } = await mount(fixture({ count: 0 }));
  let signal;
  files.readFile = (_path, options) => { signal = options.signal; return new Promise(() => {}); };
  const pending = loadDoc(ctx, 'openspec/changes/pending.md');
  await settle();
  el.isConnected = false; el.disconnectedCallback();
  assert.equal(signal?.aborted, true);
  await pending;
});

test('shared no-active probe includes archive without instance render state', async () => {
  const fs = fixture({ count: 0, archive: 1 });
  const ctx = createContext(fs, `experience-${++seq}`);
  const el = new Panel();
  assert.match(await el._probe(ctx), /archive\|.*any-name-0/);
});

test('partial parent cannot prove that an unreadable archive is absent', async () => {
  const ctx = createContext(fixture({ count: 0, truncatedPaths: ['openspec/changes'] }), `experience-${++seq}`);
  const result = await loadOpenSpecState(ctx, { archive: true });
  assert.equal(result.state.kind, 'error');
  assert.equal(result.state.truncated, true);
});

test('search is case insensitive, applies to loaded names only', () => {
  assert.deepEqual(names(selectChanges(changes, { search: 'ALP' })), ['alpha']);
  assert.deepEqual(selectChanges(changes, { search: 'absent' }), []);
});
for (const [filter, expected] of [['all', 5], ['not-started', 2], ['in-progress', 1], ['completed', 1], ['unknown', 1]]) {
  test(`task status filter ${filter}`, () => assert.equal(selectChanges(changes, { filter }).length, expected));
}
test('artifact filter does not infer structural invalidity', () => {
  assert.deepEqual(selectChanges(changes, { filter: 'artifacts' }), []);
  const ch = { ...changes[0], artifacts: { design: 'unknown' } };
  assert.deepEqual(selectChanges([ch], { filter: 'artifacts' }), [ch]);
});
for (const sort of ['progress-asc', 'progress-desc', 'open-tasks']) {
  test(`${sort} is deterministic, unknown counts always last`, () => {
    const result = selectChanges(changes, { sort });
    assert.equal(result.at(-1).name, sort === 'open-tasks' ? 'unknown' : 'zero');
    assert.deepEqual(result, selectChanges([...changes].reverse(), { sort }));
  });
}
test('name order has deterministic code-point tie breaking', () => {
  assert.deepEqual(names(selectChanges(changes, { sort: 'name-desc' })), ['zero', 'unknown', 'beta', 'alpha', 'Zulu']);
});
test('summary is based on known counts, zero tasks is not completed', () => {
  assert.deepEqual(workspaceSummary(changes), { loaded: 5, completed: 1, inProgress: 1, openTasks: 3, unknown: 1 });
});
test('search/filter/sort and summary issue no file requests', async () => {
  const { root, files } = await mount(); const before = { ...files.calls };
  root.querySelector('#openspec-search').value = 'CHANGE-01'; root.querySelector('#openspec-search').fire('input');
  assert.equal(root.querySelectorAll('.os-change-toggle').length, 1);
  root.querySelector('#openspec-filter').value = 'completed'; root.querySelector('#openspec-filter').fire('change');
  assert.match(root.querySelector('#openspec-body').textContent, /No matching changes/);
  root.querySelector('#openspec-sort').value = 'name-desc'; root.querySelector('#openspec-sort').fire('change');
  await settle(); assert.deepEqual(files.calls, before);
  assert.match(root.querySelector('.os-summary').textContent, /4 loaded active/);
});
test('truncated index explicitly scopes search and summary', async () => {
  const { root } = await mount(fixture({ count: 45 }));
  assert.equal(root.querySelectorAll('.os-change-toggle').length, 40);
  assert.match(root.querySelector('.os-summary').textContent, /loaded data only \(max 40\)/);
});
test('navigation restores view preferences and retains them across refresh', async () => {
  const n = nav({ 'os-search': 'change-01', 'os-filter': 'in-progress', 'os-sort': 'progress-desc', 'os-tasks': 'pending' });
  const { root, el } = await mount(fixture(), n);
  assert.equal(root.querySelector('#openspec-search').value, 'change-01');
  el._manualRefresh(); await settle(15);
  assert.equal(root.querySelector('#openspec-filter').value, 'in-progress');
  assert.equal(root.querySelectorAll('.os-change-toggle').length, 1);
});
test('invalid navigation values use safe defaults', async () => {
  const { root } = await mount(fixture(), nav({ 'os-filter': 'bogus', 'os-sort': 'bogus', 'os-view': 'bogus' }));
  assert.equal(root.querySelector('#openspec-filter').value, 'all'); assert.equal(root.querySelector('#openspec-view').value, 'active');
});
test('task filters reuse parser/cache and preserve grouped collapsed state', async () => {
  const { el, root, files } = await mount(); el._openChange('change-01'); await settle(12); el._openTab('tasks'); await settle(12);
  const section = root.querySelector('.os-task-group'); section.open = false; section.fire('toggle');
  const before = { ...files.calls };
  root.querySelectorAll('.os-task-filters button')[1].fire('click');
  assert.equal(root.querySelectorAll('.os-task').length, 1);
  assert.equal(root.querySelector('.os-task-group').open, false);
  root.querySelectorAll('.os-task-filters button')[2].fire('click');
  assert.equal(root.querySelectorAll('.os-task--done').length, 1);
  assert.equal(root.querySelector('.os-task-group').open, false);
  assert.deepEqual(files.calls, before);
  assert.equal(root.querySelectorAll('input, textarea').filter(e => e.id !== 'openspec-search').length, 0);
  el._manualRefresh(); await settle(20);
  assert.equal(root.querySelector('.os-task-group').open, false);
});
test('archive is lazy; plain arbitrary names and documents can be opened', async () => {
  const fs = fixture({ archive: 2 }); const raw = fs.listFiles.bind(fs); let archiveCalls = 0;
  fs.listFiles = (path, options) => { if (path.includes('/archive')) archiveCalls++; return raw(path, options); };
  const { el, root } = await mount(fs); assert.equal(archiveCalls, 0);
  el._switchMode('archive'); await settle(15); assert.equal(root.querySelectorAll('.os-change-toggle').length, 2);
  el._openChange('any-name-0'); await settle(15);
  assert.match(root.querySelector('.os-doc').textContent, /Useful behavior/);
  assert.match(root.querySelector('.os-doc-path').textContent, /archive\/any-name-0\/proposal.md/);
  const calls = archiveCalls; await el._checkExternalChanges(); assert.equal(archiveCalls, calls, 'archive never enters ordinary polling');
});
test('archive absent and empty is distinct from unreadable', async () => {
  const { el, root } = await mount(); el._switchMode('archive'); await settle(12);
  assert.match(root.querySelector('#openspec-body').textContent, /No archived changes/);
  el.context = createContext(fixture({ archive: 1, rejectPaths: ['openspec/changes/archive'] }), `experience-${++seq}`);
  el._switchMode('archive'); await settle(15); assert.equal(el.state.kind, 'error');
});
test('large/truncated archive is bounded and scope is explicit', async () => {
  const { el, root } = await mount(fixture({ archive: 50, truncatedPaths: ['openspec/changes/archive'] }));
  el._switchMode('archive'); await settle(20);
  assert.equal(el.state.changes.length, 40); assert.match(root.querySelector('.os-summary').textContent, /Partial listings/);
});
test('archive view can restore from navigation without mixing active change selection', async () => {
  const { root } = await mount(fixture({ archive: 1 }), nav({ 'os-view': 'archive', 'os-change': 'any-name-0' })); await settle(15);
  assert.match(root.querySelector('.os-doc-path').textContent, /archive\/any-name-0/);
});
test('batch structural diagnostics are explicit, complete and navigable', async () => {
  const { el, root, files } = await mount(); assert.equal(root.querySelector('.os-diagnostics').textContent, '');
  await el._startBatch(); assert.match(root.querySelector('.os-diagnostics').textContent, /4\/4.*4 pass/);
  const before = { ...files.calls }; await el._startBatch(); assert.deepEqual(files.calls, before, 'reuses structural and document cache');
  root.querySelector('.os-diagnostics ul button').fire('click'); await settle(10); assert.ok(root.querySelector('#openspec-detail'));
});
test('batch stop prevents further changes from being scanned', async () => {
  const { el, root, ctx } = await mount(fixture({ count: 10 }));
  const raw = ctx.files.listFiles.bind(ctx.files); let release;
  const gate = new Promise(r => { release = r; }); let started = 0;
  ctx.files.listFiles = async (path, options) => { if (/change-\d+\/$/.test(path)) { started++; await gate; } return raw(path, options); };
  const flight = el._startBatch(); await settle(3); assert.equal(started, 2);
  root.querySelector('#openspec-stop').fire('click'); release(); await flight;
  assert.equal(started, 2); assert.match(root.querySelector('.os-diagnostics').textContent, /stopped/);
});
test('refresh invalidates batch results', async () => {
  const { el, root } = await mount(); await el._startBatch(); el._manualRefresh(); await settle(15);
  assert.equal(root.querySelector('.os-diagnostics').textContent, '');
});
test('metadata failure is unverified, never a passing structural verdict', async () => {
  const fs = fixture({ count: 1 }); const list = fs.listFiles.bind(fs);
  fs.listFiles = async (path, options) => { const res = await list(path, options); if (path === 'openspec/changes/change-00/') res.entries.push({ name: '.openspec.yaml', type: 'file' }); return res; };
  const { el, root } = await mount(fs); await el._startBatch(); assert.match(root.querySelector('.os-diagnostics').textContent, /1 unverified/);
});
test('a never-settling host request times out and Refresh recovers', async () => {
  setRequestTimeoutMs(25); const fs = fixture(); let stuck = true, signal;
  const list = fs.listFiles.bind(fs);
  fs.listFiles = (path, options) => { if (path === 'openspec' && stuck) { signal = options.signal; return new Promise(() => {}); } return list(path, options); };
  const { el, root } = await mount(fs); await new Promise(r => setTimeout(r, 40));
  assert.equal(el.state.kind, 'error'); assert.match(root.querySelector('#openspec-error').textContent, /timed out/); assert.equal(signal.aborted, true);
  stuck = false; el._manualRefresh(); await settle(15); assert.equal(el.state.kind, 'ready'); assert.equal(root.querySelector('#openspec-refresh').disabled, false);
  await el._checkExternalChanges(); assert.notEqual(el.fingerprint, null);
});
test('document timeout settles coalesced consumers and permits retry', async () => {
  setRequestTimeoutMs(15); let calls = 0;
  const ctx = createContext({ readFile() { calls++; return new Promise(() => {}); } }, `experience-${++seq}`);
  const a = loadDoc(ctx, 'hung.md'), b = loadDoc(ctx, 'hung.md'); assert.equal(a, b);
  const doc = await a; assert.equal(calls, 1); assert.match(doc.error, /timed out/);
  ctx.files.readFile = async () => ({ content: 'recovered' });
  assert.equal((await loadDoc(ctx, 'hung.md', { maxAge: 0 })).content, 'recovered');
});
test('unmounting one consumer does not abort another; last consumer aborts', async () => {
  const fs = fixture(); let stall = false, signal;
  const list = fs.listFiles.bind(fs);
  fs.listFiles = (path, options) => { if (stall && path === 'openspec') { signal = options.signal; return new Promise(() => {}); } return list(path, options); };
  const { el: a, ctx } = await mount(fs);
  const b = new Panel(); panels.push(b); b.isConnected = true; b.connectedCallback(); b.context = ctx; await settle();
  stall = true; a._manualRefresh(); await settle();
  a.isConnected = false; a.disconnectedCallback(); assert.equal(signal.aborted, false);
  b.isConnected = false; b.disconnectedCallback(); assert.equal(signal.aborted, true);
  await settle();
});
test('workspace switch aborts abandoned reads and cannot show their late content', async () => {
  const { el, ctx, root } = await mount(); let release, signal;
  ctx.files.listFiles = (_path, options) => { signal = options.signal; return new Promise(r => { release = r; }); };
  el._manualRefresh(); await settle(3);
  el.context = createContext(fixture({ count: 1 }), `experience-${++seq}`); await settle(12);
  assert.equal(signal.aborted, true); release({ entries: [] }); await settle(); assert.equal(el.state.changes.length, 1);
  assert.match(root.querySelector('.os-summary').textContent, /1 loaded/);
});
test('search focus/caret and ancestor scroll survive rerender', async () => {
  const { el, root } = await mount(); el.scrollTop = 123; el.scrollLeft = 7;
  const input = root.querySelector('#openspec-search'); input.focus(); input.selectionStart = 2; input.selectionEnd = 2; input.value = 'ch'; input.fire('input');
  assert.equal(root.activeElement, input); assert.equal(input.selectionStart, 2); assert.equal(el.scrollTop, 123); assert.equal(el.scrollLeft, 7);
});
test('change button focus is restored by identity after async structural render', async () => {
  const { el, root } = await mount(); root.querySelector('.os-change-toggle').focus(); el._openChange('change-00'); await settle(15);
  assert.equal(root.activeElement.dataset.focusKey, 'change:change-00');
});
test('workspace preferences reset rather than leaking to another machine', async () => {
  const { el, root, ctx } = await mount(); root.querySelector('#openspec-search').value = 'old'; root.querySelector('#openspec-search').fire('input');
  el.context = { ...ctx, machine: { id: 'other' } }; await settle(15);
  assert.equal(root.querySelector('#openspec-search').value, ''); assert.equal(root.querySelectorAll('.os-change-toggle').length, 4);
});
test('two mounted panels coalesce concurrent probes', async () => {
  const { el: a, ctx, files } = await mount();
  const b = new Panel(); panels.push(b); b.isConnected = true; b.connectedCallback(); b.context = ctx; await settle(15);
  const before = files.calls.list;
  await Promise.all([a._checkExternalChanges(), b._checkExternalChanges()]);
  assert.equal(files.calls.list - before, 13); // top + 4 * (change, specs, capability)
});
test('host invalidation for two panels shares one fresh index generation', async () => {
  const { el: a, ctx, files } = await mount();
  const b = new Panel(); panels.push(b); b.isConnected = true; b.connectedCallback(); b.context = ctx; await settle(15);
  const raw = files.listFiles.bind(files); let indexes = 0;
  files.listFiles = (path, options) => { if (path === 'openspec') indexes++; return raw(path, options); };
  p.refreshMountedPanels(ctx); await settle(20); assert.equal(indexes, 1); assert.equal(a.state, b.state);
});
test('editing a spec file is detected without relying on directory mtime', async () => {
  const fs = fixture({ count: 1 }); const raw = fs.listFiles.bind(fs); let version = 1;
  fs.listFiles = async (path, options) => { const res = await raw(path, options); return { ...res, entries: res.entries.map(e => ({ ...e, modifiedAt: e.name === 'spec.md' ? version : 1 })) }; };
  const { el } = await mount(fs); const previous = el.state;
  version++; await el._checkExternalChanges(); await settle(15); assert.notEqual(el.state, previous);
});
test('poll requests are bounded to six simultaneous host calls', async () => {
  const fs = fixture({ count: 20 }); const raw = fs.listFiles.bind(fs); let running = 0, peak = 0;
  fs.listFiles = async (path, options) => { running++; peak = Math.max(peak, running); try { await new Promise(r => setTimeout(r, 1)); return await raw(path, options); } finally { running--; } };
  const el = new Panel(); panels.push(el); const ctx = createContext(fs, `experience-${++seq}`);
  await el._probe(ctx); assert.ok(peak > 1 && peak <= 6, `peak=${peak}`);
});

test('stopping diagnostics returns focus to Check button', async () => {
  const { el, root, ctx } = await mount(fixture({ count: 10 }));
  const list = ctx.files.listFiles.bind(ctx.files); let release;
  const gate = new Promise(r => { release = r; });
  ctx.files.listFiles = async (path, options) => { await gate; return list(path, options); };
  const running = el._startBatch(); await settle(2);
  const stop = root.querySelector('#openspec-stop'); stop.focus(); stop.fire('click');
  assert.equal(root.activeElement.id, 'openspec-check'); release(); await running;
});

test('batch render failures are handled and release running state', async () => {
  const { el, root } = await mount(); let calls = 0;
  const render = el._renderBatch.bind(el);
  el._renderBatch = () => { if (++calls === 2) throw Error('synthetic render failure'); render(); };
  await el._startBatch();
  assert.equal(root.querySelector('#openspec-check').disabled, false);
  assert.match(root.querySelector('.os-diagnostics').textContent, /interrupted/);
});

test('custom schema and skip_specs cannot produce structural pass', async () => {
  for (const metadata of ['schema: custom', 'schema: spec-driven\nskip_specs: true']) {
    const fs = fixture({ count: 1 }), list = fs.listFiles.bind(fs), read = fs.readFile.bind(fs);
    fs.listFiles = async (path, options) => { const res = await list(path, options); if (path === 'openspec/changes/change-00/') res.entries.push({ name: '.openspec.yaml', type: 'file' }); return res; };
    fs.readFile = (path, options) => path.endsWith('.openspec.yaml') ? Promise.resolve({ content: metadata }) : read(path, options);
    const { el, root } = await mount(fs); await el._startBatch(); assert.match(root.querySelector('.os-diagnostics').textContent, /1 unverified/);
  }
});

test('indented false skip_specs metadata does not defer a supported check', async () => {
  const fs = fixture({ count: 1 }), list = fs.listFiles.bind(fs), read = fs.readFile.bind(fs);
  fs.listFiles = async (path, options) => { const res = await list(path, options); if (path === 'openspec/changes/change-00/') res.entries.push({ name: '.openspec.yaml', type: 'file' }); return res; };
  fs.readFile = (path, options) => path.endsWith('.openspec.yaml') ? Promise.resolve({ content: 'schema: spec-driven\n  skip_specs: false  \n' }) : read(path, options);
  const { el, root } = await mount(fs); await el._startBatch();
  assert.match(root.querySelector('.os-diagnostics').textContent, /1 pass · 0 incomplete · 0 unverified/);
});

test('directory traversal does not begin after an operation deadline', async () => {
  const fs = fixture(); const ctx = { ...createContext(fs, `experience-${++seq}`), _openspecDeadline: Date.now() - 1 };
  const res = await loadOpenSpecState(ctx); assert.equal(res.state.kind, 'error'); assert.match(res.state.error, /operation timed out/); assert.equal(fs.calls.list, 0);
});

test('late rejected host promises are handled after timeout', async () => {
  setRequestTimeoutMs(10); let reject;
  const ctx = createContext({ readFile() { return new Promise((_resolve, r) => { reject = r; }); } }, `experience-${++seq}`);
  const doc = await loadDoc(ctx, 'late.md'); assert.match(doc.error, /timed out/);
  reject(Error('late transport failure')); await settle();
});

test('mixed-case index and probe cover the same first forty changes', async () => {
  const tree = { openspec: dir, 'openspec/changes': dir };
  const names = [...Array.from({ length: 40 }, (_, i) => `a-${i}`), 'Z-first'];
  for (const name of names) tree[`openspec/changes/${name}`] = dir;
  const fs = createMockFs({ tree }); const ctx = createContext(fs, `experience-${++seq}`);
  const state = (await loadOpenSpecState(ctx)).state;
  const paths = [], list = fs.listFiles.bind(fs);
  fs.listFiles = (path, options) => { paths.push(path.replace(/\/$/, '')); return list(path, options); };
  await new Panel()._probe(ctx);
  const probed = paths.filter(path => /^openspec\/changes\/[^/]+$/.test(path)).map(path => path.split('/').at(-1));
  assert.deepEqual(probed.sort(), state.changes.map(ch => ch.name).sort());
});

test('workspace switch clears diagnostics and control text immediately, before pending reads', async () => {
  const { el, root } = await mount(); await el._startBatch();
  root.querySelector('#openspec-search').value = 'private-old-name'; root.querySelector('#openspec-search').fire('input');
  el.context = createContext({ listFiles() { return new Promise(() => {}); } }, `experience-${++seq}`);
  assert.equal(root.querySelector('.os-diagnostics').textContent, '');
  assert.equal(root.querySelector('#openspec-search').value, '');
  assert.equal(root.querySelector('#openspec-check').disabled, true);
});

test('truncated archive document retains partial-file warning and unknown task count', async () => {
  const fs = fixture({ archive: 1 }); const read = fs.readFile.bind(fs);
  fs.readFile = async (path, options) => ({ ...await read(path, options), truncated: path.includes('/archive/') && path.endsWith('tasks.md') });
  const { el, root } = await mount(fs); el._switchMode('archive'); await settle(15);
  assert.equal(el.state.changes[0].tasks.known, false);
  el._openChange('any-name-0'); await settle(15); el._openTab('tasks'); await settle(10);
  assert.match(root.querySelector('#openspec-tabpanel').textContent, /only the readable part/);
});

test('same-workspace host context replacement during refresh still refreshes open document', async () => {
  const { el, root, ctx, files } = await mount(); el._openChange('change-00'); await settle(15);
  const read = files.readFile.bind(files); let updated = false;
  files.readFile = async (path, options) => path.endsWith('proposal.md') && updated ? { content: '# Updated proposal' } : read(path, options);
  let release; const gate = new Promise(r => { release = r; }), list = files.listFiles.bind(files); let once = true;
  files.listFiles = async (path, options) => { if (path === 'openspec' && once) { once = false; await gate; } return list(path, options); };
  updated = true; el._manualRefresh(); await settle(2); el.context = { ...ctx }; release(); await settle(20);
  assert.match(root.querySelector('.os-doc').textContent, /Updated proposal/);
  assert.equal(root.querySelector('#openspec-refresh').disabled, false);
});

test('TTL index refresh also invalidates old diagnostics and selected document', async () => {
  const { el, root, ctx, files } = await mount(); el._openChange('change-00'); await settle(15); await el._startBatch();
  const read = files.readFile.bind(files);
  files.readFile = (path, options) => path.endsWith('proposal.md') ? Promise.resolve({ content: '# TTL fresh proposal' }) : read(path, options);
  const now = Date.now;
  try {
    Date.now = () => now() + 31000;
    el.context = { ...ctx }; await settle(20);
    assert.match(root.querySelector('.os-doc').textContent, /TTL fresh proposal/);
    assert.equal(root.querySelector('.os-diagnostics').textContent, '');
  } finally { Date.now = now; }
});
