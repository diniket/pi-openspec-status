// Demonstrate behavioral fixes against unchanged PR #5, not missing new exports.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createDomStub } from '../test/dom-stub.js';
import { createMockFs, createContext, settle } from '../test/fs-mock.js';
Object.assign(globalThis, createDomStub());
const tmp = await mkdtemp(join(tmpdir(), 'openspec-regression-proof-'));
try {
  const path = join(tmp, 'baseline.mjs');
  await writeFile(path, execFileSync('git', ['show', '609c6bb:src/pi-web-plugin.js']));
  const old = await import(pathToFileURL(path).href), current = await import('../src/pi-web-plugin.js');
  const results = [];
  for (const [label, p] of [['609c6bb', old], ['working tree', current]]) {
    p.setRequestTimeoutMs?.(10);
    const fs = createMockFs({ tree: { openspec: { type: 'directory' }, 'openspec/changes': { type: 'directory' }, 'openspec/changes/x': { type: 'directory' }, 'openspec/changes/x/proposal.md': { type: 'file' } }, contents: { 'openspec/changes/x/proposal.md': '# Synthetic' } });
    const el = new p.OpenspecPanelElement(); el.isConnected = true; el.connectedCallback(); el.context = createContext(fs, label); await settle(10);
    el.shadowRoot.querySelector('.os-change-toggle').focus(); el._openChange('x'); await settle(10);
    const focus = el.shadowRoot.activeElement === el.shadowRoot.querySelector('.os-change-toggle');
    let signal;
    fs.listFiles = (_path, options) => { signal = options?.signal; return new Promise(() => {}); };
    el._manualRefresh(); await new Promise(resolve => setTimeout(resolve, 40));
    const recoveredBusy = el.shadowRoot.querySelector('#openspec-refresh').disabled === false;
    el.isConnected = false; el.disconnectedCallback();
    const aborted = signal?.aborted === true;
    results.push({ source: label, focusPreserved: focus, hungRefreshReleased: recoveredBusy, signalAborted: aborted });
    for (const value of [focus, recoveredBusy, aborted]) assert.equal(value, label === 'working tree');
    p.setRequestTimeoutMs?.(15000);
  }
  console.log(JSON.stringify({ results, verdict: 'All three behavior regressions fail on PR #5 and pass on new source.' }, null, 2));
} finally { await rm(tmp, { recursive: true }); }
