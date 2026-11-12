// Synthetic, reproducible transport benchmark; no production workspace is scanned.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createDomStub } from '../test/dom-stub.js';
Object.assign(globalThis, createDomStub());
const delayMs = Number(process.env.BENCH_DELAY_MS || 5);
const baseline = process.argv.includes('--baseline');
let temporary;
try {
  let url = new URL('../src/pi-web-plugin.js', import.meta.url);
  if (baseline) {
    temporary = await mkdtemp(join(tmpdir(), 'openspec-baseline-'));
    const path = join(temporary, 'baseline.mjs');
    await writeFile(path, execFileSync('git', ['show', '609c6bbe9be7cf586e87e94e6718978ea411e037:src/pi-web-plugin.js']));
    url = pathToFileURL(path);
  }
  const plugin = await import(url.href);
  const results = [];
  for (const [scenario, count, capsFor] of [
    ['1 change / 3 caps', 1, () => 3],
    ['40 changes / 91 caps (172-call equivalent)', 40, i => i < 11 ? 3 : 2],
    ['40 changes / 480 caps', 40, () => 12],
  ]) {
    const dirs = new Map([['openspec/changes', []]]);
    const dir = name => ({ name, type: 'directory', modifiedAt: 1, size: 0 });
    for (let i = 0; i < count; i++) {
      const name = `ch-${String(i).padStart(2, '0')}`, base = 'openspec/changes/' + name;
      dirs.get('openspec/changes').push(dir(name)); dirs.set(base, [dir('specs')]);
      dirs.set(base + '/specs', Array.from({ length: capsFor(i) }, (_, j) => dir(`cap-${j}`)));
      for (let j = 0; j < capsFor(i); j++) dirs.set(`${base}/specs/cap-${j}`, [{ name: 'spec.md', type: 'file', size: 100, modifiedAt: 1 }]);
    }
    let calls = 0, running = 0, peak = 0;
    const ctx = { machine: { id: 'synthetic' }, workspace: { id: scenario }, files: {
      async listFiles(path) {
        calls++; running++; peak = Math.max(peak, running);
        try { await new Promise(r => setTimeout(r, delayMs)); return { entries: dirs.get(path.replace(/\/$/, '')) || [], truncated: false }; }
        finally { running--; }
      },
    } };
    const el = new plugin.OpenspecPanelElement();
    const samples = [];
    for (let run = 0; run < 3; run++) {
      calls = running = peak = 0;
      const start = performance.now(); const fingerprint = await el._probe(ctx);
      if (!fingerprint?.includes('spec.md')) throw Error('Spec coverage lost');
      samples.push({ calls, ms: Math.round(performance.now() - start), peak });
    }
    samples.sort((a, b) => a.ms - b.ms);
    results.push({ scenario, ...samples[1], minMs: samples[0].ms, maxMs: samples[2].ms });
  }
  console.log(JSON.stringify({ source: baseline ? '609c6bb' : 'working tree', delayMs, iterations: 3, results }, null, 2));
} finally { if (temporary) await rm(temporary, { recursive: true }); }
