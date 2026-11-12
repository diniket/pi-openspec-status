// Run only as a development reference, never from the browser plugin.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createDomStub } from '../test/dom-stub.js';
Object.assign(globalThis, createDomStub());
const { inspectChangeValidity } = await import('../src/pi-web-plugin.js');
const proposal = '## Why\n' + 'A useful reason for this feature. '.repeat(4) + '\n## What Changes\n- work\n';
const added = '## ADDED Requirements\n### Requirement: Example\nSystem MUST work.\n#### Scenario: Works\n- **WHEN** ready\n- **THEN** works\n';
const cases = [
  { name: 'added', spec: added, expected: 'valid', cli: true },
  { name: 'empty-scenario', spec: '## ADDED Requirements\n### Requirement: Example\nSystem MUST work.\n#### Scenario: Empty\n', expected: 'invalid', cli: false },
  { name: 'removed', spec: '## REMOVED Requirements\n### Requirement: Legacy\n**Reason**: retired\n**Migration**: none\n', expected: 'unverified' },
  { name: 'renamed', spec: '## RENAMED Requirements\n- FROM: `### Requirement: Before`\n- TO: `### Requirement: After`\n', expected: 'unverified' },
  { name: 'skip-specs', spec: '', skip: true, expected: 'unverified' },
  { name: 'missing-proposal', spec: added, noProposal: true, expected: 'incomplete', cli: true },
];
const temporary = await mkdtemp(join(tmpdir(), 'openspec-cli-reference-'));
try {
  const results = [];
  for (const item of cases) {
    const dir = join(temporary, 'openspec/changes', item.name);
    await mkdir(join(dir, 'specs/cap'), { recursive: true });
    if (!item.noProposal) await writeFile(join(dir, 'proposal.md'), proposal);
    if (item.spec) await writeFile(join(dir, 'specs/cap/spec.md'), item.spec);
    if (item.skip) await writeFile(join(dir, '.openspec.yaml'), 'schema: spec-driven\nskip_specs: true\n');
    const local = inspectChangeValidity({ proposalText: item.noProposal ? null : proposal, hasProposal: !item.noProposal, specFiles: item.spec ? [{ path: 'specs/cap/spec.md', content: item.spec }] : [], hasSpecs: !!item.spec, skipSpecs: item.skip });
    assert.equal(local.state, item.expected);
    const run = spawnSync('openspec', ['validate', item.name, '--json'], { cwd: temporary, encoding: 'utf8', timeout: 15000 });
    if (run.error) throw run.error;
    const report = JSON.parse(run.stdout);
    const cliValid = report.items?.[0]?.valid;
    if (typeof cliValid !== 'boolean') throw Error('Unexpected OpenSpec CLI response');
    if (item.cli !== undefined) assert.equal(cliValid, item.cli, item.name);
    results.push({ name: item.name, local: local.state, cliValid });
  }
  const version = spawnSync('openspec', ['--version'], { encoding: 'utf8' }).stdout.trim();
  console.log(JSON.stringify({ cliVersion: version, results, note: 'Unverified is a deliberate deferral; proposal completeness is an additional local check.' }, null, 2));
} finally { await rm(temporary, { recursive: true }); }
